"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ownsBrand, requireOwnerContext } from "@/lib/auth/roles";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { CONNECT_MESSAGES } from "@/lib/connections/messages";
import { buildOAuthRedirectUrl } from "@/lib/connections/oauth";
import { createPageChoice, PAGE_CHOICE_PATH, toPageChoiceOption } from "@/lib/connections/page-choice";
import { resolvePageSelection, type ManagedPage } from "@/lib/connections/page-selection";
import {
  clearProviderTokens,
  linkedPageIdFor,
  loadBrandConnections,
  metadataString,
  saveProviderConnection,
  scopesForProvider,
  type BrandConnections,
} from "@/lib/connections/persist";
import { deriveConnectionReadiness, hasTokenValue } from "@/lib/connections/readiness";
import {
  buildPageConnection,
  exchangeCodeForUserToken,
  fetchManagedPages,
  type MetaUserAuth,
  type ProviderTokenExchange,
} from "@/lib/connections/token-exchange";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

const logger = createLogger("connections");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const providerSchema = z.enum(["facebook", "instagram"]);
type Provider = z.infer<typeof providerSchema>;

const metadataKeyMap: Record<Provider, string> = {
  facebook: "pageId",
  instagram: "igBusinessId",
};

const providerDisplayNames: Record<Provider, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business Account",
};

/** OAuth state expiry: 10 minutes */
const OAUTH_STATE_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Owners never see technical text (tasks/SPEC-plain-error-messages.md); the
 * detail goes to the log. INVALID_STATE_ERROR is shown for an unknown, used or
 * expired state, and for one someone else started.
 */
const INVALID_STATE_ERROR = CONNECT_MESSAGES.expiredLink;
const START_FAILED_ERROR = CONNECT_MESSAGES.startFailed;
const FINISH_FAILED_ERROR = CONNECT_MESSAGES.finishFailed;
const META_LOGIN_FAILED_ERROR = CONNECT_MESSAGES.metaLoginFailed;

const payloadSchema = z.object({
  provider: providerSchema,
  metadataValue: z.string().optional(),
});

const initiateOptionsSchema = z
  .object({ changePage: z.boolean().optional() })
  .optional();

// ---------------------------------------------------------------------------
// OAuth Connect: v2 schema with oauth_states + token vault
// ---------------------------------------------------------------------------

/**
 * Initiate an OAuth connect flow by creating a session-bound state in
 * the oauth_states table and returning the redirect URL.
 * Uses PLAT-09 session-bound state to prevent state fixation attacks.
 *
 * `changePage` (the Change Page button) makes the callback show the Page
 * chooser even when a stored Page matches. It is recorded on the state row as
 * redirect_to = PAGE_CHOICE_PATH, never taken from the callback URL.
 *
 * The signed-in user's id goes in created_by: only they can finish the flow.
 */
export async function initiateOAuthConnect(
  providerInput: string,
  optionsInput?: unknown,
): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  const provider = providerSchema.parse(providerInput);
  const changePage = initiateOptionsSchema.parse(optionsInput)?.changePage === true;
  const ctx = await requireOwnerContext();
  const { accountId } = ctx;
  const supabase = createServiceSupabaseClient();

  if (changePage && provider === "instagram") {
    // Facebook is the anchor: Instagram always uses the Page Facebook is on.
    let connections: BrandConnections;
    try {
      connections = await loadBrandConnections(supabase, accountId);
    } catch (error) {
      logger.error("could not check connections before Change Page", toLoggableError(error), { accountId, provider });
      return { success: false, error: START_FAILED_ERROR };
    }
    if (connections.facebook?.hasAccessToken) {
      return {
        success: false,
        error: "Instagram uses the Page connected to Facebook. To change it, use Change Page on the Facebook card.",
      };
    }
  }

  const state = randomUUID();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_EXPIRY_MS).toISOString();

  // Bind the INITIATING brand into the state so the callback attributes the
  // connection to the brand that started the flow -- not whichever brand happens
  // to be active at callback time (multi-brand: the user may switch mid-flow).
  // Bind the initiating USER too: only they can finish it (completeOAuthConnect).
  const { error } = await supabase.from("oauth_states").insert({
    state,
    provider,
    expires_at: expiresAt,
    account_id: accountId,
    created_by: ctx.user.id,
    ...(changePage ? { redirect_to: PAGE_CHOICE_PATH } : {}),
  });

  if (error) {
    logger.error("could not store the OAuth state", toLoggableError(error), { accountId, provider });
    return { success: false, error: START_FAILED_ERROR };
  }

  const redirectUrl = buildOAuthRedirectUrl(provider, state);
  return { success: true, redirectUrl };
}

/**
 * Complete an OAuth connect flow by validating state, exchanging the auth
 * code for a Meta user token, choosing the Page (tasks/SPEC-facebook-page-chooser.md)
 * and storing its token exclusively in the token vault.
 *
 * Security checks (PLAT-09):
 * - State must exist in oauth_states
 * - State must not be already used (replay prevention)
 * - State must not be expired (10-minute window)
 * - State must not be a pending Page choice (those carry an auth_code)
 * - State must have been started by the signed-in user (created_by); a row
 *   without created_by, made before this check existed, is refused too
 *
 * When the owner has to choose, nothing is connected yet: the result carries
 * `pageChoice`, the reference for /connections/choose-page, and the Meta user
 * token waits encrypted in oauth_states.
 */
export async function completeOAuthConnect(
  providerInput: string,
  code: string,
  stateParam: string,
): Promise<{ success: boolean; error?: string; pageChoice?: string }> {
  const provider = providerSchema.parse(providerInput);
  const ctx = await requireOwnerContext();
  const supabase = createServiceSupabaseClient();

  // 1. Validate state: must exist, unused, and not expired. Read the brand that
  //    STARTED the flow (account_id), which is what the connection is attributed
  //    to -- never the callback-time active brand.
  const { data: oauthState, error: stateError } = await supabase
    .from("oauth_states")
    .select("id, provider, used_at, expires_at, account_id, redirect_to, created_by")
    .eq("state", stateParam)
    .eq("provider", provider)
    .is("used_at", null)
    .is("auth_code", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (stateError) {
    logger.error("oauth_states lookup failed", toLoggableError(stateError), { provider, userId: ctx.user.id });
    return { success: false, error: FINISH_FAILED_ERROR };
  }

  if (!oauthState) {
    return { success: false, error: INVALID_STATE_ERROR };
  }

  const state = oauthState as {
    id: string;
    account_id: string | null;
    redirect_to?: string | null;
    created_by: string | null;
  };

  // Only the signed-in person who started this connection can finish it. Checked
  // before the state is marked used, so someone else's attempt does not use it up,
  // and answered like an unknown state. Ids only in the log: never the state itself.
  if (state.created_by !== ctx.user.id) {
    logger.warn("OAuth state refused: not started by the signed-in user", {
      stateId: state.id,
      accountId: state.account_id,
      provider,
      userId: ctx.user.id,
      startedBy: state.created_by,
    });
    return { success: false, error: INVALID_STATE_ERROR };
  }

  // Attribute to the initiating brand, and fail safe if the caller is no longer
  // an owner of it (e.g. access revoked or role changed during the round-trip).
  const initiatingAccountId = state.account_id;
  if (!initiatingAccountId) {
    return { success: false, error: "This connection is missing its brand. Please start it again." };
  }
  if (!ownsBrand(ctx, initiatingAccountId)) {
    return { success: false, error: "You no longer have owner access to the brand that started this connection." };
  }
  const accountId = initiatingAccountId;
  const forceChoice = state.redirect_to === PAGE_CHOICE_PATH;

  // 2. Mark state as used before proceeding (prevents replay)
  const { error: markError } = await supabase
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", state.id)
    .eq("account_id", accountId)
    .eq("created_by", ctx.user.id);

  if (markError) {
    logger.error("could not mark the OAuth state used", toLoggableError(markError), { stateId: state.id, accountId, provider });
    return { success: false, error: FINISH_FAILED_ERROR };
  }

  // 3. Exchange the auth code for a user token and list the Pages it manages.
  //    Meta's own error text (already token-redacted) goes to the log, not the owner.
  let auth: MetaUserAuth;
  let pages: ManagedPage[];
  try {
    auth = await exchangeCodeForUserToken(provider, code);
    pages = await fetchManagedPages(auth.userAccessToken);
  } catch (error) {
    logger.error("Meta login or Page list failed", toLoggableError(error), { accountId, provider });
    return { success: false, error: META_LOGIN_FAILED_ERROR };
  }

  // 4. Choose the Page: linked (same Page as the other platform), stored, only, or the owner's choice
  let connections: BrandConnections;
  try {
    connections = await loadBrandConnections(supabase, accountId);
  } catch (error) {
    logger.error("could not load connections to choose a Page", toLoggableError(error), { accountId, provider });
    return { success: false, error: "We could not check this brand's connections. Please try again." };
  }

  const own = connections[provider];
  const linkedPageId = linkedPageIdFor(provider, connections);
  const selection = resolvePageSelection({
    provider,
    pages,
    storedPageId: metadataString(own, "pageId"),
    storedInstagramId: provider === "instagram" ? metadataString(own, "igBusinessId") : null,
    linkedPageId,
    forceChoice,
  });

  if (selection.kind === "error") {
    logger.warn("no Page could be connected", { accountId, provider, code: selection.code, pageCount: pages.length });
    return { success: false, error: selection.message };
  }

  if (selection.kind === "choose") {
    try {
      const pageChoice = await createPageChoice(supabase, {
        userId: ctx.user.id,
        accountId,
        provider,
        changePage: forceChoice,
        userAccessToken: auth.userAccessToken,
        expiresAt: auth.expiresAt,
        metaUserId: auth.metaUserId,
        currentPageId: own?.hasAccessToken ? metadataString(own, "pageId") : null,
        instagramPageId: provider === "facebook" ? linkedPageId : null,
        pages: selection.pages.map(toPageChoiceOption),
      });
      logger.info("Page choice needed", { accountId, provider, pageCount: selection.pages.length, changePage: forceChoice });
      return { success: true, pageChoice };
    } catch (error) {
      logger.error("could not store the Page choice", toLoggableError(error), { accountId, provider });
      return { success: false, error: "We could not save your list of Pages. Please try again." };
    }
  }

  // 5. Store the selected Page's token, as before
  let exchange: ProviderTokenExchange;
  try {
    exchange = buildPageConnection(provider, selection.page, auth);
  } catch (error) {
    // buildPageConnection throws owner-readable reasons (see its doc comment).
    const message = error instanceof Error ? error.message : FINISH_FAILED_ERROR;
    logger.warn("selected Page cannot be connected", { accountId, provider, message });
    return { success: false, error: message };
  }

  const saved = await saveProviderConnection(supabase, {
    accountId,
    provider,
    exchange,
    scopes: scopesForProvider(provider),
  });
  if (!saved.success) {
    return saved;
  }

  // 6. Invalidate caches
  revalidatePath("/connections");
  revalidatePath("/");

  return { success: true };
}

/**
 * Disconnect a provider: delete its stored tokens and mark it needs_action.
 * Tokens are only held while needed, so the token_vault rows and any legacy
 * plaintext copy go (as in offboardBrand and revokeMetaUserData). The row
 * itself stays, keeping its metadata and history for a reconnect.
 * 'disconnected' is not an allowed status (social_connections_status_check).
 */
export async function disconnectProvider(
  providerInput: string,
): Promise<{ success: boolean; error?: string }> {
  const provider = providerSchema.parse(providerInput);
  const { accountId } = await requireOwnerContext();
  const supabase = createServiceSupabaseClient();

  const result = await clearProviderTokens(supabase, accountId, provider);
  if (!result.success) {
    return result;
  }

  revalidatePath("/connections");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Metadata management (retained from v1 with v2 column fixes)
// ---------------------------------------------------------------------------

/**
 * Failures are returned, not thrown: production hides a thrown server action
 * message behind React's generic one, so the owner would never see the reason.
 */
export async function updateConnectionMetadata(input: unknown) {
  const { provider, metadataValue } = payloadSchema.parse(input);
  const value = metadataValue?.trim() ?? "";
  const { accountId } = await requireOwnerContext();
  const supabase = createServiceSupabaseClient();
  const saveFailed = { ok: false as const, error: "We could not save this. Please try again." };

  const { data: existing, error: fetchError } = await supabase
    .from("social_connections")
    .select("id, metadata, status, platform_account_name, display_name, access_token, token_expires_at, expires_at")
    .eq("account_id", accountId)
    .eq("provider", provider)
    .maybeSingle<{
      id: string;
      metadata: Record<string, unknown> | null;
      status: string | null;
      platform_account_name: string | null;
      display_name: string | null;
      access_token?: string | null;
      token_expires_at: string | null;
      expires_at: string | null;
    }>();

  if (fetchError && !isSchemaMissingError(fetchError)) {
    logger.error("metadata save: connection lookup failed", toLoggableError(fetchError), { accountId, provider });
    return saveFailed;
  }

  if (!existing) {
    return { ok: false as const, error: `Connect your ${providerDisplayNames[provider]} before saving this.` };
  }

  const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
  const key = metadataKeyMap[provider];
  const nextMetadata = { ...metadata };

  if (value.length > 0) {
    nextMetadata[key] = value;
  } else {
    delete nextMetadata[key];
  }

  const evaluation = evaluateUpdatedMetadata(provider, nextMetadata);
  let hasAccessToken: boolean;
  try {
    hasAccessToken = hasTokenValue(existing.access_token) || await hasVaultAccessToken(supabase, existing.id);
  } catch (error) {
    logger.error("metadata save: token lookup failed", toLoggableError(error), { accountId, provider });
    return saveFailed;
  }
  const readiness = deriveConnectionReadiness({
    provider,
    storedStatus: evaluation.complete && hasAccessToken ? "active" : existing.status,
    metadataComplete: evaluation.complete,
    hasAccessToken,
    expiresAt: existing.token_expires_at ?? existing.expires_at,
  });

  const updatePayload: Record<string, unknown> = {
    metadata: nextMetadata,
    status: readiness.status,
  };

  const { error: updateError } = await supabase
    .from("social_connections")
    .update(updatePayload)
    .eq("account_id", accountId)
    .eq("provider", provider);

  if (updateError && !isSchemaMissingError(updateError)) {
    logger.error("metadata save: update failed", toLoggableError(updateError), { accountId, provider });
    return saveFailed;
  }

  const message = evaluation.complete
    ? `${providerDisplayNames[provider]} metadata saved.`
    : `${providerDisplayNames[provider]} metadata missing required fields.`;

  const { error: notificationError } = await supabase.from("notifications").insert({
    account_id: accountId,
    category: "connection_metadata_updated",
    message,
    metadata: {
      provider,
      metadataKey: key,
      value: value.length ? value : null,
    },
  });

  if (notificationError) {
    console.error("[connections] failed to insert metadata notification", notificationError);
  }

  revalidatePath("/connections");
  revalidatePath("/planner");
  return {
    ok: true as const,
    provider,
    metadata: nextMetadata,
    value: value.length > 0 ? value : null,
    metadataComplete: evaluation.complete,
    missingKeys: evaluation.missingKeys,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function hasVaultAccessToken(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  connectionId: string,
) {
  const { data, error } = await supabase
    .from("token_vault")
    .select("id")
    .eq("social_connection_id", connectionId)
    .eq("token_type", "access")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (isSchemaMissingError(error)) {
      return false;
    }
    throw error;
  }

  return Boolean(data?.id);
}

function evaluateUpdatedMetadata(
  provider: Provider,
  metadata: Record<string, unknown>,
) {
  return evaluateConnectionMetadata(provider, metadata);
}
