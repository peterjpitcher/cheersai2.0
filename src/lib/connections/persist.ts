/**
 * Saving and clearing Facebook and Instagram connections, shared by the OAuth
 * callback and the Page chooser. Plain server module, not a "use server" file,
 * so none of this is callable from the browser.
 *
 * Service-role client throughout: every social_connections query carries
 * .eq("account_id", accountId); token_vault has no account_id and is reached
 * only through the brand's own connection ids.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { CONNECTION_SAVE_MESSAGES } from "@/lib/connections/messages";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { FACEBOOK_SCOPE_LIST, INSTAGRAM_SCOPE_LIST, type Provider } from "@/lib/connections/oauth";
import { deriveConnectionReadiness, hasTokenValue } from "@/lib/connections/readiness";
import type { ProviderTokenExchange } from "@/lib/connections/token-exchange";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import { storeEncryptedToken } from "@/lib/providers/token-helpers";
import { isSchemaMissingError } from "@/lib/supabase/errors";

const logger = createLogger("connections");

export interface BrandConnection {
  id: string;
  provider: Provider;
  metadata: Record<string, unknown>;
  /** A token is held (token_vault, or the legacy plaintext column). */
  hasAccessToken: boolean;
}

export type BrandConnections = Partial<Record<Provider, BrandConnection>>;

type SaveResult = { success: boolean; error?: string };

/** The OAuth scopes requested for each platform; stored so the record matches the request. */
export function scopesForProvider(provider: Provider): string[] {
  return provider === "facebook" ? [...FACEBOOK_SCOPE_LIST] : [...INSTAGRAM_SCOPE_LIST];
}

export function metadataString(connection: BrandConnection | undefined, key: string): string | null {
  const value = connection?.metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The Page the OTHER platform is connected to, only while it holds a token.
 * A disconnected row keeps its metadata for a reconnect but no longer binds.
 */
export function linkedPageIdFor(provider: Provider, connections: BrandConnections): string | null {
  const other = connections[provider === "facebook" ? "instagram" : "facebook"];
  return other?.hasAccessToken ? metadataString(other, "pageId") : null;
}

/** The brand's Facebook and Instagram rows and whether each holds a token. Throws on a query error. */
export async function loadBrandConnections(supabase: SupabaseClient, accountId: string): Promise<BrandConnections> {
  const { data, error } = await supabase
    .from("social_connections")
    .select("id, provider, metadata, access_token")
    .eq("account_id", accountId)
    .in("provider", ["facebook", "instagram"]);

  if (error) {
    throw new Error(`Could not load connections: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    provider: Provider;
    metadata: Record<string, unknown> | null;
    access_token?: string | null;
  }>;

  const vaultIds = new Set<string>();
  if (rows.length) {
    const { data: vaultRows, error: vaultError } = await supabase
      .from("token_vault")
      .select("social_connection_id")
      .in("social_connection_id", rows.map((row) => row.id))
      .eq("token_type", "access");

    if (vaultError && !isSchemaMissingError(vaultError)) {
      throw new Error(`Could not check stored tokens: ${vaultError.message}`);
    }
    for (const row of (vaultRows ?? []) as Array<{ social_connection_id: string | null }>) {
      if (row.social_connection_id) vaultIds.add(row.social_connection_id);
    }
  }

  const connections: BrandConnections = {};
  for (const row of rows) {
    connections[row.provider] = {
      id: row.id,
      provider: row.provider,
      metadata: row.metadata ?? {},
      hasAccessToken: hasTokenValue(row.access_token) || vaultIds.has(row.id),
    };
  }
  return connections;
}

/**
 * Upserts the connection as needs_action, stores its tokens in the vault, then
 * activates it. A failure part-way leaves it needs_action, which preflight
 * refuses to publish through (fail closed).
 */
export async function saveProviderConnection(
  supabase: SupabaseClient,
  {
    accountId,
    provider,
    exchange,
    scopes,
  }: { accountId: string; provider: Provider; exchange: ProviderTokenExchange; scopes: string[] },
): Promise<SaveResult> {
  const metadata = exchange.metadata ?? {};
  const metadataEvaluation = evaluateConnectionMetadata(provider, metadata);

  const { data: connection, error: upsertError } = await supabase
    .from("social_connections")
    .upsert(
      {
        account_id: accountId,
        provider,
        platform_account_id: derivePlatformAccountId(provider, metadata),
        platform_account_name: exchange.displayName ?? null,
        status: "needs_action",
        scopes,
        token_expires_at: exchange.expiresAt ?? null,
        metadata,
        display_name: exchange.displayName ?? null,
        last_synced_at: new Date().toISOString(),
        // Lets the Meta deletion and deauthorise callbacks find this connection.
        // Only written when known, so a failed lookup never erases a stored id.
        ...(exchange.metaUserId ? { meta_user_id: exchange.metaUserId } : {}),
      },
      { onConflict: "account_id,provider" },
    )
    .select("id")
    .single();

  if (upsertError || !connection) {
    logger.error("social_connections upsert failed", toLoggableError(upsertError ?? "no row returned"), { accountId, provider });
    return { success: false, error: CONNECTION_SAVE_MESSAGES.saveFailed };
  }

  // Tokens live only in the token vault (PLAT-09 / C-3).
  try {
    await storeEncryptedToken(connection.id, "access", exchange.accessToken);
    if (exchange.refreshToken) {
      await storeEncryptedToken(connection.id, "refresh", exchange.refreshToken);
    }
  } catch (error) {
    // The owner cannot fix a missing key, so they get a plain message and the
    // log names the cause (TOKEN_VAULT_KEY in Vercel and the edge function secrets).
    const keyMissing = error instanceof Error && /TOKEN_VAULT_KEY|encryption key/i.test(error.message);
    logger.error(
      keyMissing ? "token vault write failed: TOKEN_VAULT_KEY is missing or invalid" : "token vault write failed",
      toLoggableError(error),
      { accountId, provider, connectionId: connection.id },
    );
    return { success: false, error: CONNECTION_SAVE_MESSAGES.secureStoreFailed };
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
    .eq("id", connection.id)
    .eq("account_id", accountId);

  if (statusError) {
    logger.error("could not activate the connection", toLoggableError(statusError), { accountId, provider, connectionId: connection.id });
    return { success: false, error: CONNECTION_SAVE_MESSAGES.activateFailed };
  }

  return { success: true };
}

/**
 * Deletes a platform's stored tokens and marks it needs_action (the Disconnect
 * button). The row stays, keeping its metadata and history for a reconnect.
 * 'disconnected' is not an allowed status (social_connections_status_check).
 */
export async function clearProviderTokens(
  supabase: SupabaseClient,
  accountId: string,
  provider: Provider,
): Promise<SaveResult> {
  const failure = { success: false, error: CONNECTION_SAVE_MESSAGES.disconnectFailed };

  const { data: connections, error: lookupError } = await supabase
    .from("social_connections")
    .select("id")
    .eq("account_id", accountId)
    .eq("provider", provider);

  if (lookupError) {
    logger.error("disconnect lookup failed", toLoggableError(lookupError), { accountId, provider });
    return failure;
  }

  const connectionIds = ((connections ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (!connectionIds.length) {
    return { success: true };
  }

  // token_vault has no account_id; the ids above are already brand-scoped.
  const { error: vaultError } = await supabase
    .from("token_vault")
    .delete()
    .in("social_connection_id", connectionIds);

  if (vaultError) {
    logger.error("disconnect token_vault delete failed", toLoggableError(vaultError), { accountId, provider });
    return failure;
  }

  const { error: updateError } = await supabase
    .from("social_connections")
    .update({
      status: "needs_action",
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("provider", provider);

  if (updateError) {
    logger.error("disconnect update failed", toLoggableError(updateError), { accountId, provider });
    return failure;
  }

  return { success: true };
}

/** platform_account_id from the stored ids; 'default' when none is known. */
function derivePlatformAccountId(provider: Provider, metadata: Record<string, unknown>): string {
  const key = provider === "facebook" ? "pageId" : "igBusinessId";
  return typeof metadata[key] === "string" ? (metadata[key] as string) : "default";
}
