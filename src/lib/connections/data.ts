import { requireAuthContext } from "@/lib/auth/server";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import {
  deriveConnectionReadiness,
  hasTokenValue,
  type ConnectionReadinessIssue,
  type ConnectionStatus,
} from "@/lib/connections/readiness";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export interface ConnectionSummary {
  provider: "facebook" | "instagram" | "gbp";
  status: ConnectionStatus;
  ready: boolean;
  lastSyncedAt?: string;
  expiresAt?: string;
  displayName: string;
  hasAccessToken: boolean;
  metadata?: Record<string, unknown> | null;
  metadataValid: boolean;
  metadataMissingKeys: string[];
  issues: ConnectionReadinessIssue[];
}

/**
 * Mixed v1/v2 row shape for social_connections.
 * access_token is optional because newer deployments store it in token_vault.
 */
type ConnectionRow = {
  id: string;
  provider: "facebook" | "instagram" | "gbp";
  status: string | null;
  platform_account_name: string | null;
  display_name: string | null;
  last_synced_at: string | null;
  token_expires_at: string | null;
  expires_at: string | null;
  access_token?: string | null;
  metadata: Record<string, unknown> | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business",
  gbp: "Google Business Profile",
};

const PROVIDERS = ["facebook", "instagram", "gbp"] as const;

export async function listConnectionSummaries(): Promise<ConnectionSummary[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await selectConnections(supabase, accountId);

    if (error) {
      if (isSchemaMissingError(error)) {
        return fallbackConnections();
      }
      throw error;
    }

    const rows = data ?? [];
    const vaultAccessTokenIds = await listVaultAccessTokenIds(supabase, rows.map((row) => row.id));
    const byProvider = new Map(rows.map((row) => [row.provider, row]));

    return PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      if (!row) {
        return fallbackConnection(provider);
      }

      const evaluation = evaluateConnectionMetadata(row.provider, row.metadata);
      // Prefer token_expires_at (v2); fall back to legacy expires_at for GBP connections
      const effectiveExpiry = row.token_expires_at ?? row.expires_at;
      const hasAccessToken = hasTokenValue(row.access_token) || vaultAccessTokenIds.has(row.id);
      const readiness = deriveConnectionReadiness({
        provider: row.provider,
        storedStatus: row.status,
        metadataComplete: evaluation.complete,
        hasAccessToken,
        expiresAt: effectiveExpiry,
      });

      return {
        provider: row.provider,
        status: readiness.status,
        ready: readiness.ready,
        lastSyncedAt: row.last_synced_at ?? undefined,
        expiresAt: effectiveExpiry ?? undefined,
        displayName: row.display_name ?? row.platform_account_name ?? PROVIDER_LABELS[row.provider],
        hasAccessToken,
        metadata: row.metadata ?? undefined,
        metadataValid: evaluation.complete,
        metadataMissingKeys: evaluation.missingKeys,
        issues: readiness.issues,
      } satisfies ConnectionSummary;
    });
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return fallbackConnections();
    }
    throw error;
  }
}

function fallbackConnections(): ConnectionSummary[] {
  return PROVIDERS.map((provider) => fallbackConnection(provider));
}

function fallbackConnection(provider: (typeof PROVIDERS)[number]): ConnectionSummary {
  const readiness = deriveConnectionReadiness({
    provider,
    storedStatus: "needs_action",
    metadataComplete: false,
    hasAccessToken: false,
    expiresAt: null,
    connected: false,
  });

  return {
    provider,
    status: readiness.status,
    ready: false,
    displayName: PROVIDER_LABELS[provider],
    hasAccessToken: false,
    metadataValid: false,
    metadataMissingKeys: [],
    issues: readiness.issues,
  };
}

async function selectConnections(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>["supabase"],
  accountId: string,
) {
  const baseQuery = supabase
    .from("social_connections")
    .select(
      "id, provider, status, platform_account_name, display_name, last_synced_at, token_expires_at, expires_at, access_token, metadata",
    )
    .eq("account_id", accountId)
    .order("provider")
    .returns<ConnectionRow[]>();

  const result = await baseQuery;
  if (!result.error || !isSchemaMissingError(result.error)) {
    return result;
  }

  return supabase
    .from("social_connections")
    .select(
      "id, provider, status, platform_account_name, display_name, last_synced_at, token_expires_at, expires_at, metadata",
    )
    .eq("account_id", accountId)
    .order("provider")
    .returns<ConnectionRow[]>();
}

async function listVaultAccessTokenIds(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>["supabase"],
  connectionIds: string[],
) {
  if (!connectionIds.length) {
    return new Set<string>();
  }

  const { data, error } = await supabase
    .from("token_vault")
    .select("social_connection_id")
    .in("social_connection_id", connectionIds)
    .eq("token_type", "access")
    .returns<Array<{ social_connection_id: string | null }>>();

  if (error) {
    if (isSchemaMissingError(error)) {
      return new Set<string>();
    }
    throw error;
  }

  return new Set(
    (data ?? [])
      .map((row) => row.social_connection_id)
      .filter((id): id is string => Boolean(id)),
  );
}
