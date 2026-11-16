/**
 * A valid Google access token for a brand's Google connection, refreshing it
 * when needed (tasks/SPEC-gbp-posting-reintroduction.md, section 4).
 *
 * Google access tokens last about an hour, so unlike Facebook's they are
 * refreshed as a matter of course. Server only. No token, code or secret is
 * ever logged.
 *
 * Parallel refreshes: the connection row is the lock. A refresh claims the row
 * with a compare-and-set on the `updated_at` it read; only the winner writes
 * the token vault, then records the new expiry (again only if nobody claimed
 * the row since). The loser stores nothing and uses the token Google just gave
 * it, which is valid in its own right. The expiry is recorded after the vault
 * write, so a reader never sees a fresh expiry beside a stale token.
 *
 * The caller checks the brand's googlePosts switch: this module has no
 * signed-in user to check it against.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GOOGLE_PROVIDER } from "@/lib/connections/google-messages";
import { GoogleTokenError, isGoogleConfigured, refreshGoogleAccessToken } from "@/lib/connections/google-oauth";
import { readGoogleVaultToken, writeGoogleVaultToken } from "@/lib/connections/google-persist";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";

const logger = createLogger("connections");

/** Refresh this long before the stored expiry, so a token never dies mid-request. */
export const GOOGLE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type GoogleAccessTokenResult =
  | {
      ok: true;
      /** Never log it. */
      accessToken: string;
      expiresAt: string;
      /** True when Google was asked for a new token on this call. */
      refreshed: boolean;
    }
  | {
      ok: false;
      /**
       * - not_connected: the brand has no Google connection
       * - reconnect_needed: Google revoked the access, or nothing usable is stored;
       *   the owner must connect again
       * - try_again: a temporary failure (Google's token endpoint, our database or
       *   our configuration); the connection is left as it is
       */
      reason: "not_connected" | "reconnect_needed" | "try_again";
    };

interface ConnectionRow {
  id: string;
  status: string | null;
  token_expires_at: string | null;
  updated_at: string;
}

export async function getGoogleAccessToken(
  supabase: SupabaseClient,
  accountId: string,
): Promise<GoogleAccessTokenResult> {
  const context: Record<string, unknown> = { accountId, provider: GOOGLE_PROVIDER };

  const { data: connection, error: lookupError } = await supabase
    .from("social_connections")
    .select("id, status, token_expires_at, updated_at")
    .eq("account_id", accountId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle<ConnectionRow>();

  if (lookupError) {
    logger.error("Google connection lookup failed", toLoggableError(lookupError), context);
    return { ok: false, reason: "try_again" };
  }
  if (!connection) {
    return { ok: false, reason: "not_connected" };
  }
  context.connectionId = connection.id;

  if (connection.status !== "active" && connection.status !== "expiring") {
    return { ok: false, reason: "reconnect_needed" };
  }

  // 1. The stored token, while it has more than the margin left.
  const expiresAtMs = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : Number.NaN;
  if (connection.token_expires_at && Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > GOOGLE_REFRESH_MARGIN_MS) {
    try {
      const stored = await readGoogleVaultToken(supabase, connection.id, "access");
      if (stored) {
        return { ok: true, accessToken: stored, expiresAt: connection.token_expires_at, refreshed: false };
      }
    } catch (error) {
      logger.error("stored Google access token could not be read", toLoggableError(error), context);
      return { ok: false, reason: "try_again" };
    }
    // No access token stored: fall through and mint one from the refresh token.
  }

  // 2. Refresh.
  let refreshToken: string | null;
  try {
    refreshToken = await readGoogleVaultToken(supabase, connection.id, "refresh");
  } catch (error) {
    // A query or decrypt failure is ours to fix, not a reason to make the owner reconnect.
    logger.error("stored Google refresh token could not be read", toLoggableError(error), context);
    return { ok: false, reason: "try_again" };
  }
  if (!refreshToken) {
    await markReconnectNeeded(supabase, accountId, connection, context, "no refresh token is stored");
    return { ok: false, reason: "reconnect_needed" };
  }

  if (!isGoogleConfigured()) {
    logger.error("Google token refresh skipped: the OAuth client is not configured", new Error("missing client"), context);
    return { ok: false, reason: "try_again" };
  }

  let minted: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
  try {
    minted = await refreshGoogleAccessToken(refreshToken);
  } catch (error) {
    if (error instanceof GoogleTokenError && error.kind === "invalid_grant") {
      // Revoked or expired at Google: only a new sign-in fixes it.
      await markReconnectNeeded(supabase, accountId, connection, context, "Google refused the refresh token");
      return { ok: false, reason: "reconnect_needed" };
    }
    // Outage, timeout or a refusal that is not about the grant: leave the connection alone.
    logger.warn("Google token refresh failed, will be retried", {
      ...context,
      kind: error instanceof GoogleTokenError ? error.kind : "unexpected",
      status: error instanceof GoogleTokenError ? error.status : null,
      oauthError: error instanceof GoogleTokenError ? error.oauthError : null,
    });
    return { ok: false, reason: "try_again" };
  }

  const result: GoogleAccessTokenResult = {
    ok: true,
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt,
    refreshed: true,
  };

  // 3. Claim the row. `updated_at` is passed back exactly as it was read (the
  //    database keeps microseconds, which a Date round trip would lose). A
  //    BEFORE UPDATE trigger stamps the new value, so it is read back.
  const { data: claimed, error: claimError } = await supabase
    .from("social_connections")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", connection.id)
    .eq("account_id", accountId)
    .eq("updated_at", connection.updated_at)
    .select("id, updated_at");

  if (claimError) {
    logger.error("could not claim the Google connection to store a refreshed token", toLoggableError(claimError), context);
    return result;
  }
  const claim = Array.isArray(claimed) && claimed.length === 1 ? (claimed[0] as { updated_at: string }) : null;
  if (!claim) {
    // Someone else refreshed, reconnected or disconnected since the read: their
    // write is newer and stays. This token is used once and not stored.
    return result;
  }

  // 4. Store the token (and a new refresh token, only if Google sent one).
  try {
    await writeGoogleVaultToken(supabase, connection.id, "access", minted.accessToken);
    if (minted.refreshToken) {
      await writeGoogleVaultToken(supabase, connection.id, "refresh", minted.refreshToken);
    }
  } catch (error) {
    // The stored expiry is unchanged, so the next call simply refreshes again.
    logger.error("refreshed Google token could not be stored", toLoggableError(error), context);
    return result;
  }

  // 5. Record the new expiry, unless the row was claimed again meanwhile.
  const { error: expiryError } = await supabase
    .from("social_connections")
    .update({ token_expires_at: minted.expiresAt })
    .eq("id", connection.id)
    .eq("account_id", accountId)
    .eq("updated_at", claim.updated_at);

  if (expiryError) {
    logger.error("could not record the refreshed Google token expiry", toLoggableError(expiryError), context);
  }

  return result;
}

/**
 * Marks the connection needs_action, once: only if it has not changed since it
 * was read (so a reconnect that landed meanwhile is not undone). Later calls
 * stop at the status check without asking Google again.
 */
async function markReconnectNeeded(
  supabase: SupabaseClient,
  accountId: string,
  connection: ConnectionRow,
  context: Record<string, unknown>,
  why: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("social_connections")
    .update({ status: "needs_action" })
    .eq("id", connection.id)
    .eq("account_id", accountId)
    .eq("updated_at", connection.updated_at)
    .select("id");

  if (error) {
    logger.error("could not mark the Google connection as needing a reconnect", toLoggableError(error), context);
    return;
  }
  if (Array.isArray(data) && data.length === 1) {
    logger.warn("Google connection needs to be reconnected", { ...context, why });
  }
}
