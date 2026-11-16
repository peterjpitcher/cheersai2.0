"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ownedBrandIds, ownsBrand, requireOwnerContext } from "@/lib/auth/roles";
import { requireAuthContext } from "@/lib/auth/server";
import { activeBrandHasGooglePosts, brandHasGooglePosts } from "@/lib/connections/google-access";
import {
  claimGoogleLocationChoice,
  createGoogleLocationChoice,
  readGoogleLocationChoice,
} from "@/lib/connections/google-choice";
import { GOOGLE_LOCATION_CHOICE_FAILURE_MESSAGES } from "@/lib/connections/google-choice-view";
import { GoogleListError, listGoogleLocations, type GoogleLocationList } from "@/lib/connections/google-locations";
import {
  GOOGLE_CONNECT_MESSAGES,
  GOOGLE_LIST_FAILURE_MESSAGES,
  GOOGLE_LOCATION_ID_PATTERN,
  GOOGLE_PROVIDER,
  GOOGLE_SCOPE,
} from "@/lib/connections/google-messages";
import {
  buildGoogleOAuthUrl,
  exchangeGoogleCode,
  GoogleTokenError,
  isGoogleConfigured,
  type GoogleTokens,
} from "@/lib/connections/google-oauth";
import { saveGoogleConnection } from "@/lib/connections/google-persist";
import { CONNECT_MESSAGES } from "@/lib/connections/messages";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const logger = createLogger("connections");

/** OAuth state expiry: 10 minutes, as for Facebook. */
const OAUTH_STATE_EXPIRY_MS = 10 * 60 * 1000;

const choiceSchema = z.object({
  choice: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  locationId: z.string().regex(GOOGLE_LOCATION_ID_PATTERN),
});

/**
 * Google connection actions (tasks/SPEC-gbp-posting-reintroduction.md, section 4).
 *
 * Every action here re-checks, on the server, that the brand has the
 * googlePosts switch on (decision D10: the owner's own profiles only) and
 * fails closed when it does not. Nothing here publishes anything.
 */

/**
 * Starts the Google sign-in: stores a state bound to the brand and the
 * signed-in owner, and returns Google's consent URL.
 */
export async function initiateGoogleConnect(): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  const ctx = await requireOwnerContext();
  const { accountId } = ctx;

  if (!activeBrandHasGooglePosts(ctx)) {
    logger.warn("Google connect refused: the brand does not have Google posting", { accountId, userId: ctx.user.id });
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.notAvailable };
  }
  if (!isGoogleConfigured()) {
    logger.warn("Google connect refused: the OAuth client is not configured", { accountId });
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.notSetUp };
  }

  const supabase = createServiceSupabaseClient();
  const state = randomUUID();

  const { error } = await supabase.from("oauth_states").insert({
    state,
    provider: GOOGLE_PROVIDER,
    expires_at: new Date(Date.now() + OAUTH_STATE_EXPIRY_MS).toISOString(),
    account_id: accountId,
    created_by: ctx.user.id,
  });

  if (error) {
    logger.error("could not store the Google OAuth state", toLoggableError(error), { accountId });
    return { success: false, error: CONNECT_MESSAGES.startFailed };
  }

  return { success: true, redirectUrl: buildGoogleOAuthUrl(state) };
}

/**
 * Finishes the Google sign-in: validates the state, swaps the code for tokens,
 * lists the locations the login manages and stores them, encrypted, for the
 * owner to choose from. Nothing is connected here: `locationChoice` is the
 * reference for /connections/choose-location, and a location is never picked
 * automatically, even when there is only one.
 *
 * Fails closed. If Google refuses the listing (it answers 429 or 403 until it
 * approves API access for the Cloud project), no connection, no token and no
 * pending choice is stored.
 */
export async function completeGoogleConnect(
  code: string,
  stateParam: string,
): Promise<{ success: boolean; error?: string; locationChoice?: string }> {
  const ctx = await requireOwnerContext();
  const supabase = createServiceSupabaseClient();

  // 1. The state must exist, be unused and unexpired, and be a login state
  //    (a pending location choice carries an auth_code and is refused here).
  const { data: oauthState, error: stateError } = await supabase
    .from("oauth_states")
    .select("id, account_id, created_by")
    .eq("state", stateParam)
    .eq("provider", GOOGLE_PROVIDER)
    .is("used_at", null)
    .is("auth_code", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<{ id: string; account_id: string | null; created_by: string | null }>();

  if (stateError) {
    logger.error("oauth_states lookup failed", toLoggableError(stateError), { provider: GOOGLE_PROVIDER, userId: ctx.user.id });
    return { success: false, error: CONNECT_MESSAGES.finishFailed };
  }
  if (!oauthState) {
    return { success: false, error: CONNECT_MESSAGES.expiredLink };
  }

  // Only the signed-in person who started this connection can finish it.
  if (oauthState.created_by !== ctx.user.id) {
    logger.warn("Google OAuth state refused: not started by the signed-in user", {
      stateId: oauthState.id,
      accountId: oauthState.account_id,
      userId: ctx.user.id,
      startedBy: oauthState.created_by,
    });
    return { success: false, error: CONNECT_MESSAGES.expiredLink };
  }

  // The connection belongs to the brand that started the flow, never the brand
  // selected now. The caller must still own it, and it must still have Google on.
  const accountId = oauthState.account_id;
  if (!accountId) {
    return { success: false, error: "This connection is missing its brand. Please start it again." };
  }
  if (!ownsBrand(ctx, accountId)) {
    return { success: false, error: "You no longer have owner access to the brand that started this connection." };
  }
  const context = { accountId, provider: GOOGLE_PROVIDER, userId: ctx.user.id };

  // 2. Mark the state used before anything else (prevents replay), including
  //    when the flow is about to be refused.
  const { error: markError } = await supabase
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", oauthState.id)
    .eq("account_id", accountId)
    .eq("created_by", ctx.user.id);

  if (markError) {
    logger.error("could not mark the Google OAuth state used", toLoggableError(markError), { ...context, stateId: oauthState.id });
    return { success: false, error: CONNECT_MESSAGES.finishFailed };
  }

  if (!brandHasGooglePosts(ctx, accountId)) {
    logger.warn("Google callback refused: the brand does not have Google posting", context);
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.notAvailable };
  }
  if (!isGoogleConfigured()) {
    logger.warn("Google callback refused: the OAuth client is not configured", context);
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.notSetUp };
  }

  // 3. Swap the code for tokens. They are held in memory only from here.
  let tokens: GoogleTokens;
  try {
    tokens = await exchangeGoogleCode(code);
  } catch (error) {
    logger.warn("Google code exchange failed", { ...context, ...tokenErrorSummary(error) });
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.loginFailed };
  }

  if (!tokens.refreshToken) {
    // prompt=consent is always sent, so this should not happen; without a
    // refresh token posting would stop within the hour.
    logger.warn("Google sent no refresh token", context);
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.noRefreshToken };
  }
  if (tokens.scopes.length && !tokens.scopes.includes(GOOGLE_SCOPE)) {
    logger.warn("Google sign-in finished without the business scope", context);
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.permissionDenied };
  }

  // 4. List what the login can manage. Any refusal stores nothing.
  let list: GoogleLocationList;
  try {
    list = await listGoogleLocations(tokens.accessToken);
  } catch (error) {
    if (error instanceof GoogleListError) {
      logger.warn("Google refused the account or location list: nothing was saved", {
        ...context,
        kind: error.kind,
        step: error.step,
        status: error.status,
        googleStatus: error.googleStatus,
        reason: error.reason,
      });
      return { success: false, error: GOOGLE_LIST_FAILURE_MESSAGES[error.kind] };
    }
    logger.error("Google account or location list failed unexpectedly", new Error("unexpected listing failure"), context);
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.listFailed };
  }

  if (list.accountCount === 0) {
    logger.warn("Google login manages no accounts", context);
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.noAccounts };
  }
  if (list.locations.length === 0) {
    logger.warn("Google login manages no locations", { ...context, accountCount: list.accountCount });
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.noLocations };
  }

  // 5. Hand off to the picker. The tokens wait encrypted in oauth_states only.
  let currentLocationId: string | null = null;
  const { data: current, error: currentError } = await supabase
    .from("social_connections")
    .select("platform_account_id, status")
    .eq("account_id", accountId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle<{ platform_account_id: string | null; status: string | null }>();
  if (currentError) {
    logger.warn("could not read the current Google connection for the picker", { ...context, message: currentError.message });
  } else if (current && current.status !== "needs_action") {
    currentLocationId = current.platform_account_id;
  }

  try {
    const locationChoice = await createGoogleLocationChoice(supabase, {
      userId: ctx.user.id,
      accountId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      incomplete: list.incomplete,
      currentLocationId,
      locations: list.locations,
    });
    logger.info("Google location choice needed", {
      ...context,
      locationCount: list.locations.length,
      accountCount: list.accountCount,
      incomplete: list.incomplete,
    });
    return { success: true, locationChoice };
  } catch (error) {
    logger.error("could not store the Google location choice", toLoggableError(error), context);
    return { success: false, error: GOOGLE_CONNECT_MESSAGES.choiceSaveFailed };
  }
}

export interface GoogleLocationChoiceResult {
  success: boolean;
  error?: string;
}

/**
 * The owner picked a location. Fails closed at every step: the choice must be
 * theirs, unused and unexpired, the brand must still have Google on, and the
 * location must be one of those they were shown (checked against the stored
 * list, never trusted from the browser). The tokens go from the encrypted
 * hand-off straight to the token vault.
 */
export async function chooseGoogleLocation(input: unknown): Promise<GoogleLocationChoiceResult> {
  const parsed = choiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: GOOGLE_LOCATION_CHOICE_FAILURE_MESSAGES.not_found };
  }
  const { choice: token, locationId } = parsed.data;

  const ctx = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const read = await readGoogleLocationChoice(supabase, {
    token,
    userId: ctx.user.id,
    ownedAccountIds: ownedBrandIds(ctx),
  });
  if (!read.ok) {
    const details = { reason: read.reason, userId: ctx.user.id, provider: GOOGLE_PROVIDER };
    if (read.reason === "lookup_failed") {
      logger.error("could not read the Google location choice", new Error("oauth_states lookup failed"), details);
    } else {
      logger.warn("Google location choice refused", details);
    }
    return { success: false, error: GOOGLE_LOCATION_CHOICE_FAILURE_MESSAGES[read.reason] };
  }

  const { payload } = read.choice;
  const { accountId } = payload;
  const context = { accountId, provider: GOOGLE_PROVIDER, userId: ctx.user.id };

  const refusal = !brandHasGooglePosts(ctx, accountId)
    ? { reason: "google_posts_off", error: GOOGLE_CONNECT_MESSAGES.notAvailable }
    : !isGoogleConfigured()
      ? { reason: "not_configured", error: GOOGLE_CONNECT_MESSAGES.notSetUp }
      : null;
  if (refusal) {
    // Discard the choice, so the Google tokens it holds do not wait out the 10 minutes.
    try {
      await claimGoogleLocationChoice(supabase, read.choice);
    } catch (error) {
      logger.error("could not discard a refused Google location choice", toLoggableError(error), context);
    }
    logger.warn("Google location choice refused", { ...context, reason: refusal.reason });
    return { success: false, error: refusal.error };
  }

  const location = payload.locations.find((candidate) => candidate.id === locationId);
  if (!location) {
    logger.warn("Google location choice refused", { ...context, reason: "location_not_shown" });
    return { success: false, error: "That location was not in your list. Start again from the Connections screen." };
  }

  // Single use: claim it before saving, so a double submit or a replay stops here.
  let claimed: boolean;
  try {
    claimed = await claimGoogleLocationChoice(supabase, read.choice);
  } catch (error) {
    logger.error("could not claim the Google location choice", toLoggableError(error), context);
    return { success: false, error: "We could not finish this. Please start again from the Connections screen." };
  }
  if (!claimed) {
    logger.warn("Google location choice refused", { ...context, reason: "already_used" });
    return { success: false, error: GOOGLE_LOCATION_CHOICE_FAILURE_MESSAGES.used };
  }

  const saved = await saveGoogleConnection(supabase, {
    accountId,
    location,
    tokens: {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresAt: payload.expiresAt,
      scopes: payload.scopes,
    },
  });
  if (!saved.success) {
    // saveGoogleConnection logged the cause and left any previous connection as it was.
    return { success: false, error: saved.error ?? "We could not save this location. Please start again." };
  }

  logger.info("Google location chosen", context);
  revalidatePath("/connections");
  revalidatePath("/");
  return { success: true };
}

/** What may be logged about a failed token call: never a token, a code or the secret. */
function tokenErrorSummary(error: unknown): Record<string, unknown> {
  if (error instanceof GoogleTokenError) {
    return { kind: error.kind, status: error.status, oauthError: error.oauthError };
  }
  return { kind: "unexpected" };
}
