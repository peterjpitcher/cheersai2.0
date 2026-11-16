/**
 * Saving a brand's Google connection once a location has been chosen. Plain
 * server module, not a "use server" file, so none of it is callable from the
 * browser.
 *
 * Service-role client throughout: every social_connections query carries
 * .eq("account_id", accountId); token_vault has no account_id and is reached
 * only through the brand's own connection id.
 *
 * Unlike the Facebook save (./persist.ts), a failure here leaves any previous
 * Google connection as it was: the existing row is only touched last, in one
 * update, and the tokens it held are put back if that update fails.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GoogleLocationCandidate } from "@/lib/connections/google-locations";
import { GOOGLE_PROVIDER, GOOGLE_SCOPE } from "@/lib/connections/google-messages";
import { CONNECTION_SAVE_MESSAGES } from "@/lib/connections/messages";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import { decrypt, encrypt, type EncryptedPayload } from "@/lib/token-vault";

const logger = createLogger("connections");

type SaveResult = { success: boolean; error?: string };
type TokenType = "access" | "refresh";

export interface GoogleConnectionTokens {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires. */
  expiresAt: string;
  scopes: string[];
}

interface VaultRow {
  token_type: TokenType;
  ciphertext: string;
  iv: string;
  tag: string;
  key_version: number;
}

/** The only three keys stored about the location (spec section 10: routing ids and the title). */
export function buildGoogleConnectionMetadata(location: GoogleLocationCandidate): Record<string, string | null> {
  return {
    localPostParent: location.id,
    locationTitle: location.title,
    placeId: location.placeId,
  };
}

/**
 * Stores the chosen location and both tokens. The connection is active only
 * once the location and the token vault write have both succeeded.
 */
export async function saveGoogleConnection(
  supabase: SupabaseClient,
  {
    accountId,
    location,
    tokens,
  }: { accountId: string; location: GoogleLocationCandidate; tokens: GoogleConnectionTokens },
): Promise<SaveResult> {
  const context = { accountId, provider: GOOGLE_PROVIDER };

  // Encrypt first: a missing or invalid TOKEN_VAULT_KEY fails here, before anything is written.
  let sealed: Record<TokenType, EncryptedPayload>;
  try {
    sealed = { access: encrypt(tokens.accessToken), refresh: encrypt(tokens.refreshToken) };
  } catch (error) {
    logger.error("Google tokens could not be encrypted: check TOKEN_VAULT_KEY", toLoggableError(error), context);
    return { success: false, error: CONNECTION_SAVE_MESSAGES.secureStoreFailed };
  }

  const fields = {
    platform_account_id: location.id,
    platform_account_name: location.title,
    display_name: location.title,
    metadata: buildGoogleConnectionMetadata(location),
    scopes: tokens.scopes.length ? tokens.scopes : [GOOGLE_SCOPE],
    token_expires_at: tokens.expiresAt,
  };

  const { data: existing, error: lookupError } = await supabase
    .from("social_connections")
    .select("id")
    .eq("account_id", accountId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle<{ id: string }>();

  if (lookupError) {
    logger.error("Google connection lookup failed", toLoggableError(lookupError), context);
    return { success: false, error: CONNECTION_SAVE_MESSAGES.saveFailed };
  }

  return existing
    ? replaceConnection(supabase, { accountId, connectionId: existing.id, fields, sealed })
    : createConnection(supabase, { accountId, fields, sealed });
}

/** First connection: a new row, removed again if its tokens cannot be stored. */
async function createConnection(
  supabase: SupabaseClient,
  {
    accountId,
    fields,
    sealed,
  }: { accountId: string; fields: Record<string, unknown>; sealed: Record<TokenType, EncryptedPayload> },
): Promise<SaveResult> {
  const context = { accountId, provider: GOOGLE_PROVIDER };

  const { data: created, error: insertError } = await supabase
    .from("social_connections")
    .insert({ account_id: accountId, provider: GOOGLE_PROVIDER, status: "needs_action", ...fields })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !created) {
    logger.error("Google connection insert failed", toLoggableError(insertError ?? "no row returned"), context);
    return { success: false, error: CONNECTION_SAVE_MESSAGES.saveFailed };
  }

  const undo = async (): Promise<void> => {
    const { error: vaultError } = await supabase.from("token_vault").delete().eq("social_connection_id", created.id);
    const { error: rowError } = await supabase
      .from("social_connections")
      .delete()
      .eq("id", created.id)
      .eq("account_id", accountId);
    if (vaultError || rowError) {
      // Left as needs_action without usable tokens: nothing can publish through it.
      logger.error("could not remove a half-saved Google connection", toLoggableError(vaultError ?? rowError), {
        ...context,
        connectionId: created.id,
      });
    }
  };

  const stored = await writeVault(supabase, created.id, sealed);
  if (stored) {
    logger.error("Google token vault write failed", toLoggableError(stored), { ...context, connectionId: created.id });
    await undo();
    return { success: false, error: CONNECTION_SAVE_MESSAGES.secureStoreFailed };
  }

  const { error: activateError } = await supabase
    .from("social_connections")
    .update({ status: "active" })
    .eq("id", created.id)
    .eq("account_id", accountId);

  if (activateError) {
    logger.error("could not activate the Google connection", toLoggableError(activateError), {
      ...context,
      connectionId: created.id,
    });
    await undo();
    return { success: false, error: CONNECTION_SAVE_MESSAGES.activateFailed };
  }

  return { success: true };
}

/**
 * Reconnect or change of location. Tokens first, then the row in one update;
 * if either fails the tokens that were there before are put back, so the
 * previous connection keeps working.
 */
async function replaceConnection(
  supabase: SupabaseClient,
  {
    accountId,
    connectionId,
    fields,
    sealed,
  }: {
    accountId: string;
    connectionId: string;
    fields: Record<string, unknown>;
    sealed: Record<TokenType, EncryptedPayload>;
  },
): Promise<SaveResult> {
  const context = { accountId, provider: GOOGLE_PROVIDER, connectionId };

  const { data: before, error: snapshotError } = await supabase
    .from("token_vault")
    .select("token_type, ciphertext, iv, tag, key_version")
    .eq("social_connection_id", connectionId);

  if (snapshotError) {
    logger.error("could not read the stored Google tokens before replacing them", toLoggableError(snapshotError), context);
    return { success: false, error: CONNECTION_SAVE_MESSAGES.saveFailed };
  }
  const snapshot = (before ?? []) as VaultRow[];

  const stored = await writeVault(supabase, connectionId, sealed);
  if (stored) {
    logger.error("Google token vault write failed", toLoggableError(stored), context);
    await restoreVault(supabase, connectionId, snapshot, context);
    return { success: false, error: CONNECTION_SAVE_MESSAGES.secureStoreFailed };
  }

  const { data: updated, error: updateError } = await supabase
    .from("social_connections")
    .update({ ...fields, status: "active" })
    .eq("id", connectionId)
    .eq("account_id", accountId)
    .select("id");

  if (updateError || !Array.isArray(updated) || updated.length !== 1) {
    logger.error("Google connection update failed", toLoggableError(updateError ?? "no row updated"), context);
    await restoreVault(supabase, connectionId, snapshot, context);
    return { success: false, error: CONNECTION_SAVE_MESSAGES.saveFailed };
  }

  return { success: true };
}

/** Upserts both tokens. Returns the error, or null when both are stored. */
async function writeVault(
  supabase: SupabaseClient,
  connectionId: string,
  sealed: Record<TokenType, EncryptedPayload>,
): Promise<unknown> {
  for (const tokenType of ["access", "refresh"] as const) {
    const error = await upsertVaultRow(supabase, connectionId, {
      token_type: tokenType,
      ciphertext: sealed[tokenType].ciphertext,
      iv: sealed[tokenType].iv,
      tag: sealed[tokenType].tag,
      key_version: sealed[tokenType].keyVersion,
    });
    if (error) return error;
  }
  return null;
}

async function upsertVaultRow(supabase: SupabaseClient, connectionId: string, row: VaultRow): Promise<unknown> {
  const { error } = await supabase
    .from("token_vault")
    .upsert({ social_connection_id: connectionId, ...row }, { onConflict: "social_connection_id,token_type" });
  return error ?? null;
}

/** Best effort: puts back the tokens held before a failed replace, and removes any that were not there. */
async function restoreVault(
  supabase: SupabaseClient,
  connectionId: string,
  snapshot: VaultRow[],
  context: Record<string, unknown>,
): Promise<void> {
  for (const tokenType of ["access", "refresh"] as const) {
    const previous = snapshot.find((row) => row.token_type === tokenType);
    const error = previous
      ? await upsertVaultRow(supabase, connectionId, previous)
      : (
          await supabase
            .from("token_vault")
            .delete()
            .eq("social_connection_id", connectionId)
            .eq("token_type", tokenType)
        ).error;
    if (error) {
      logger.error("could not put back the previous Google tokens", toLoggableError(error), { ...context, tokenType });
    }
  }
}

/** Reads and decrypts one stored token. Null when no row is stored; throws on a query or decrypt failure. */
export async function readGoogleVaultToken(
  supabase: SupabaseClient,
  connectionId: string,
  tokenType: TokenType,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("token_vault")
    .select("ciphertext, iv, tag, key_version")
    .eq("social_connection_id", connectionId)
    .eq("token_type", tokenType)
    .maybeSingle<Omit<VaultRow, "token_type">>();

  if (error) {
    throw new Error(`token_vault lookup failed: ${error.message}`);
  }
  if (!data) return null;
  return decrypt({ ciphertext: data.ciphertext, iv: data.iv, tag: data.tag, keyVersion: data.key_version });
}

/** Encrypts and stores one token for an existing connection. Throws on failure. */
export async function writeGoogleVaultToken(
  supabase: SupabaseClient,
  connectionId: string,
  tokenType: TokenType,
  plaintext: string,
): Promise<void> {
  const sealed = encrypt(plaintext);
  const error = await upsertVaultRow(supabase, connectionId, {
    token_type: tokenType,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    tag: sealed.tag,
    key_version: sealed.keyVersion,
  });
  if (error) {
    throw toLoggableError(error);
  }
}
