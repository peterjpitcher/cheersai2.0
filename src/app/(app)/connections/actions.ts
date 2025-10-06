"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/server";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { buildOAuthRedirectUrl } from "@/lib/connections/oauth";
import { exchangeProviderAuthCode } from "@/lib/connections/token-exchange";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

const providerSchema = z.enum(["facebook", "instagram", "gbp"]);

const metadataKeyMap: Record<z.infer<typeof providerSchema>, string> = {
  facebook: "pageId",
  instagram: "igBusinessId",
  gbp: "locationId",
};

const providerDisplayNames: Record<z.infer<typeof providerSchema>, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business Account",
  gbp: "Google Business Profile",
};

const UNUSED_STATE_MAX_AGE_MINUTES = 30;
const USED_STATE_MAX_AGE_HOURS = 24;

const payloadSchema = z.object({
  provider: providerSchema,
  metadataValue: z.string().optional(),
});

const oauthPayloadSchema = z.object({
  provider: providerSchema,
  redirectTo: z.string().url().optional(),
});

const completeSchema = z.object({
  state: z.string().uuid(),
});

export async function updateConnectionMetadata(input: unknown) {
  const { provider, metadataValue } = payloadSchema.parse(input);
  const value = metadataValue?.trim() ?? "";
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: existing, error: fetchError } = await supabase
    .from("social_connections")
    .select("id, metadata, status, access_token")
    .eq("account_id", accountId)
    .eq("provider", provider)
    .maybeSingle<{ id: string; metadata: Record<string, unknown> | null; status: string | null; access_token: string | null }>();

  const metadata = (existing?.metadata ?? {}) as Record<string, unknown>;

  if (fetchError && !isSchemaMissingError(fetchError)) {
    throw fetchError;
  }

  const key = metadataKeyMap[provider];
  const nextMetadata = { ...metadata };

  if (value.length > 0) {
    nextMetadata[key] = value;
  } else {
    delete nextMetadata[key];
  }

  const evaluation = evaluateUpdatedMetadata(provider, nextMetadata);

  const updatePayload: Record<string, unknown> = {};
  if (!fetchError || !isSchemaMissingError(fetchError)) {
    updatePayload.metadata = nextMetadata;
  }

  if (!evaluation.complete) {
    updatePayload.status = "needs_action";
  } else if (existing?.status === "needs_action" && existing?.access_token) {
    updatePayload.status = "active";
  }

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

function evaluateUpdatedMetadata(
  provider: z.infer<typeof providerSchema>,
  metadata: Record<string, unknown>,
) {
  return evaluateConnectionMetadata(provider, metadata);
}

export async function startConnectionOAuth(input: unknown) {
  const { provider, redirectTo } = oauthPayloadSchema.parse(input);
  await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  await cleanupStaleOAuthStates(supabase);

  const state = randomUUID();

  const { error } = await supabase
    .from("oauth_states")
    .insert({ provider, state, redirect_to: redirectTo ?? null });

  if (error) {
    throw error;
  }

  const url = buildOAuthRedirectUrl(provider, state);

  return {
    ok: true as const,
    provider,
    state,
    url,
  };
}

export async function completeConnectionOAuth(input: unknown) {
  const { state } = completeSchema.parse(input);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: oauthState, error: stateError } = await supabase
    .from("oauth_states")
    .select("provider, auth_code, error, redirect_to")
    .eq("state", state)
    .maybeSingle<{
      provider: string;
      auth_code: string | null;
      error: string | null;
      redirect_to: string | null;
    }>();

  if (stateError) {
    throw stateError;
  }

  if (!oauthState) {
    throw new Error("OAuth state not found – please restart the connection flow.");
  }

  if (oauthState.error) {
    throw new Error(oauthState.error);
  }

  if (!oauthState.auth_code) {
    throw new Error("Authorization code missing – try reconnecting again.");
  }

  const provider = providerSchema.parse(oauthState.provider);

  const { data: existingConnection, error: connectionError } = await supabase
    .from("social_connections")
    .select("id, metadata, display_name")
    .eq("account_id", accountId)
    .eq("provider", provider)
    .maybeSingle<{ id: string; metadata: Record<string, unknown> | null; display_name: string | null }>();

  if (connectionError && !isSchemaMissingError(connectionError)) {
    throw connectionError;
  }

  if (!existingConnection) {
    throw new Error("Connection record missing. Please create the connection first.");
  }

  const exchange = await exchangeProviderAuthCode(provider, oauthState.auth_code, {
    existingMetadata: existingConnection.metadata ?? null,
  });

  const combinedMetadata = {
    ...(existingConnection.metadata ?? {}),
    ...(exchange.metadata ?? {}),
  };

  const metadataEvaluation = evaluateConnectionMetadata(provider, combinedMetadata);

  const updatePayload: Record<string, unknown> = {
    access_token: exchange.accessToken,
    refresh_token: exchange.refreshToken ?? null,
    expires_at: exchange.expiresAt ?? null,
    status: metadataEvaluation.complete ? "active" : "needs_action",
    display_name: exchange.displayName ?? existingConnection.display_name ?? null,
    updated_at: new Date().toISOString(),
  };

  if (!connectionError || !isSchemaMissingError(connectionError)) {
    updatePayload.metadata = combinedMetadata;
  }

  const { error: updateError } = await supabase
    .from("social_connections")
    .update(updatePayload)
    .eq("id", existingConnection.id);

  if (updateError && !isSchemaMissingError(updateError)) {
    throw updateError;
  }

  const { error: notificationError } = await supabase.from("notifications").insert({
    account_id: accountId,
    category: "connection_reconnected",
    message: `${providerDisplayNames[provider]} reconnected successfully`,
    metadata: {
      provider,
      state,
    },
  });

  if (notificationError) {
    console.error("[connections] failed to insert reconnect notification", notificationError);
  }

  revalidatePath("/connections");
  revalidatePath("/planner");

  await cleanupStaleOAuthStates(supabase);

  return {
    ok: true as const,
    provider,
    redirectTo: resolveRedirectPath(oauthState.redirect_to),
  };
}

async function cleanupStaleOAuthStates(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const now = Date.now();
  const unusedCutoffIso = new Date(now - UNUSED_STATE_MAX_AGE_MINUTES * 60 * 1000).toISOString();
  const usedCutoffIso = new Date(now - USED_STATE_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const { error: unusedError } = await supabase
      .from("oauth_states")
      .delete()
      .lte("created_at", unusedCutoffIso)
      .is("used_at", null);

    if (unusedError && !isSchemaMissingError(unusedError)) {
      console.warn("[connections] failed to prune unused oauth states", unusedError);
    }
  } catch (error) {
    if (!isSchemaMissingError(error)) {
      console.warn("[connections] unexpected error pruning unused oauth states", error);
    }
  }

  try {
    const { error: usedError } = await supabase
      .from("oauth_states")
      .delete()
      .lte("used_at", usedCutoffIso)
      .not("used_at", "is", null);

    if (usedError && !isSchemaMissingError(usedError)) {
      console.warn("[connections] failed to prune used oauth states", usedError);
    }
  } catch (error) {
    if (!isSchemaMissingError(error)) {
      console.warn("[connections] unexpected error pruning used oauth states", error);
    }
  }
}

function resolveRedirectPath(value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith("/")) {
    return null;
  }
  if (value.startsWith("//")) {
    return null;
  }
  return value;
}
