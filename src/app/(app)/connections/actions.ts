"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/server";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { buildOAuthRedirectUrl } from "@/lib/connections/oauth";
import { deriveConnectionReadiness, hasTokenValue } from "@/lib/connections/readiness";
import { exchangeProviderAuthCode } from "@/lib/connections/token-exchange";
import { storeEncryptedToken } from "@/lib/providers/token-helpers";
import {
  getGbpLocationIdValidationError,
  normalizeCanonicalGbpLocationId,
  normalizeGbpLocalPostParent,
} from "@/lib/gbp/location-id";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const providerSchema = z.enum(["facebook", "instagram", "gbp"]);
type Provider = z.infer<typeof providerSchema>;

const metadataKeyMap: Record<Provider, string> = {
  facebook: "pageId",
  instagram: "igBusinessId",
  gbp: "locationId",
};

const providerDisplayNames: Record<Provider, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business Account",
  gbp: "Google Business Profile",
};

/** OAuth state expiry: 10 minutes */
const OAUTH_STATE_EXPIRY_MS = 10 * 60 * 1000;

const payloadSchema = z.object({
  provider: providerSchema,
  metadataValue: z.string().optional(),
});

// ---------------------------------------------------------------------------
// OAuth Connect — v2 schema with oauth_states + token vault
// ---------------------------------------------------------------------------

/**
 * Initiate an OAuth connect flow by creating a session-bound state in
 * the oauth_states table and returning the redirect URL.
 * Uses PLAT-09 session-bound state to prevent state fixation attacks.
 */
export async function initiateOAuthConnect(
  providerInput: string,
): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  const provider = providerSchema.parse(providerInput);
  await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const state = randomUUID();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_EXPIRY_MS).toISOString();

  const { error } = await supabase.from("oauth_states").insert({
    state,
    provider,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("[connections] failed to insert oauth_states", error);
    return { success: false, error: "Failed to initiate OAuth flow" };
  }

  const redirectUrl = buildOAuthRedirectUrl(provider, state);
  return { success: true, redirectUrl };
}

/**
 * Complete an OAuth connect flow by validating state, exchanging the auth
 * code for tokens, and storing them exclusively in the token vault.
 *
 * Security checks (PLAT-09):
 * - State must exist in oauth_states
 * - State must not be already used (replay prevention)
 * - State must not be expired (10-minute window)
 */
export async function completeOAuthConnect(
  providerInput: string,
  code: string,
  stateParam: string,
): Promise<{ success: boolean; error?: string }> {
  const provider = providerSchema.parse(providerInput);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // 1. Validate state: must exist, unused, and not expired
  const { data: oauthState, error: stateError } = await supabase
    .from("oauth_states")
    .select("id, provider, used_at, expires_at")
    .eq("state", stateParam)
    .eq("provider", provider)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (stateError) {
    console.error("[connections] oauth_states lookup failed", stateError);
    return { success: false, error: "OAuth state validation failed" };
  }

  if (!oauthState) {
    return { success: false, error: "Invalid or expired OAuth state" };
  }

  // 2. Mark state as used before proceeding (prevents replay)
  const { error: markError } = await supabase
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", oauthState.id);

  if (markError) {
    console.error("[connections] failed to mark oauth_states used", markError);
    return { success: false, error: "Failed to process OAuth state" };
  }

  const existingConnection = await loadExistingConnection(supabase, accountId, provider);

  // 3. Exchange auth code for tokens
  const exchange = await exchangeProviderAuthCode(provider, code, {
    existingMetadata: existingConnection?.metadata ?? null,
    existingDisplayName:
      existingConnection?.display_name ?? existingConnection?.platform_account_name ?? null,
  });

  // 4. Derive platform account ID from metadata
  const platformAccountId = derivePlatformAccountId(provider, exchange.metadata);
  const metadataEvaluation = evaluateUpdatedMetadata(provider, exchange.metadata ?? {});

  // 5. Upsert social_connections. Keep it needs_action until token vault writes succeed.
  const { data: connection, error: upsertError } = await supabase
    .from("social_connections")
    .upsert(
      {
        account_id: accountId,
        provider,
        platform_account_id: platformAccountId,
        platform_account_name: exchange.displayName ?? null,
        status: "needs_action",
        scopes: getScopesForProvider(provider),
        token_expires_at: exchange.expiresAt ?? null,
        metadata: exchange.metadata ?? {},
        display_name: exchange.displayName ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,provider" },
    )
    .select("id")
    .single();

  if (upsertError) {
    console.error("[connections] social_connections upsert failed", upsertError);
    return { success: false, error: "Failed to save connection" };
  }

  // 6. Store tokens exclusively in token vault (PLAT-09 / C-3)
  try {
    await storeEncryptedToken(connection.id, "access", exchange.accessToken);

    if (exchange.refreshToken) {
      await storeEncryptedToken(connection.id, "refresh", exchange.refreshToken);
    }
  } catch (error) {
    console.error("[connections] token vault write failed", error);
    return { success: false, error: "Failed to store connection tokens" };
  }

  const readiness = deriveConnectionReadiness({
    provider,
    storedStatus: "active",
    metadataComplete: metadataEvaluation.complete,
    hasAccessToken: true,
    expiresAt: exchange.expiresAt ?? null,
  });

  const { error: statusError } = await supabase
    .from("social_connections")
    .update({ status: readiness.status })
    .eq("id", connection.id);

  if (statusError) {
    console.error("[connections] failed to activate connection", statusError);
    return { success: false, error: "Failed to activate connection" };
  }

  // 7. Invalidate caches
  revalidatePath("/connections");
  revalidatePath("/");

  return { success: true };
}

/**
 * Disconnect a provider by updating status to 'disconnected'.
 * Does NOT delete the row -- preserves history for audit trail.
 */
export async function disconnectProvider(
  providerInput: string,
): Promise<{ success: boolean; error?: string }> {
  const provider = providerSchema.parse(providerInput);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { error } = await supabase
    .from("social_connections")
    .update({ status: "disconnected" })
    .eq("account_id", accountId)
    .eq("provider", provider);

  if (error) {
    const fallback = await supabase
      .from("social_connections")
      .update({ status: "needs_action" })
      .eq("account_id", accountId)
      .eq("provider", provider);

    if (fallback.error) {
      console.error("[connections] disconnectProvider failed", error);
      return { success: false, error: "Failed to disconnect provider" };
    }
  }

  revalidatePath("/connections");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Metadata management (retained from v1 with v2 column fixes)
// ---------------------------------------------------------------------------

export async function updateConnectionMetadata(input: unknown) {
  const { provider, metadataValue } = payloadSchema.parse(input);
  const rawValue = metadataValue?.trim() ?? "";
  const value = normaliseMetadataValue(provider, rawValue);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

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
    throw fetchError;
  }

  if (!existing) {
    throw new Error(`Connect ${providerDisplayNames[provider]} before saving metadata.`);
  }

  const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
  const key = metadataKeyMap[provider];
  const nextMetadata = { ...metadata };

  if (value.length > 0) {
    nextMetadata[key] = value;
    const localPostParent = provider === "gbp" ? normalizeGbpLocalPostParent(rawValue) : null;
    if (localPostParent) {
      nextMetadata.localPostParent = localPostParent;
    } else if (
      provider === "gbp" &&
      normalizeCanonicalGbpLocationId(nextMetadata.localPostParent as string | null | undefined) !== value
    ) {
      delete nextMetadata.localPostParent;
    }
  } else {
    delete nextMetadata[key];
    if (provider === "gbp") {
      delete nextMetadata.localPostParent;
    }
  }

  const evaluation = evaluateUpdatedMetadata(provider, nextMetadata);
  const hasAccessToken = hasTokenValue(existing.access_token) || await hasVaultAccessToken(supabase, existing.id);
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
    throw updateError;
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

async function loadExistingConnection(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
  provider: Provider,
) {
  const { data, error } = await supabase
    .from("social_connections")
    .select("id, metadata, display_name, platform_account_name")
    .eq("account_id", accountId)
    .eq("provider", provider)
    .maybeSingle<{
      id: string;
      metadata: Record<string, unknown> | null;
      display_name: string | null;
      platform_account_name: string | null;
    }>();

  if (error && !isSchemaMissingError(error)) {
    throw error;
  }

  return data ?? null;
}

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

function normaliseMetadataValue(provider: Provider, value: string) {
  if (provider !== "gbp" || value.length === 0) {
    return value;
  }
  const validationError = getGbpLocationIdValidationError(value);
  if (validationError) {
    throw new Error(validationError);
  }
  return normalizeCanonicalGbpLocationId(value) ?? value;
}

function evaluateUpdatedMetadata(
  provider: Provider,
  metadata: Record<string, unknown>,
) {
  return evaluateConnectionMetadata(provider, metadata);
}

/**
 * Derive the platform_account_id from exchange metadata.
 * Falls back to 'default' when no platform-specific ID is available.
 */
function derivePlatformAccountId(
  provider: Provider,
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (!metadata) return "default";

  switch (provider) {
    case "facebook":
      return typeof metadata.pageId === "string" ? metadata.pageId : "default";
    case "instagram":
      return typeof metadata.igBusinessId === "string" ? metadata.igBusinessId : "default";
    case "gbp":
      return typeof metadata.locationId === "string" ? metadata.locationId : "default";
    default:
      return "default";
  }
}

/**
 * Return the OAuth scopes used for each provider.
 */
function getScopesForProvider(provider: Provider): string[] {
  switch (provider) {
    case "facebook":
      return [
        "pages_show_list", "pages_read_engagement", "pages_manage_posts",
        "pages_manage_metadata", "instagram_basic", "instagram_content_publish",
        "instagram_manage_comments", "business_management",
      ];
    case "instagram":
      return [
        "instagram_basic", "instagram_content_publish", "instagram_manage_comments",
        "pages_show_list", "pages_read_engagement", "business_management",
      ];
    case "gbp":
      return ["https://www.googleapis.com/auth/business.manage"];
    default:
      return [];
  }
}
