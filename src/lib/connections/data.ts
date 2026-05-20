import { requireAuthContext } from "@/lib/auth/server";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export type ConnectionStatus = "active" | "expiring" | "needs_action";

export interface ConnectionSummary {
  provider: "facebook" | "instagram" | "gbp";
  status: ConnectionStatus;
  lastSyncedAt?: string;
  expiresAt?: string;
  displayName: string;
  metadata?: Record<string, unknown> | null;
  metadataValid: boolean;
  metadataMissingKeys: string[];
}

/**
 * V2 schema row shape for social_connections.
 * Uses platform_account_name and token_expires_at (not v1 display_name/expires_at).
 * No access_token or refresh_token columns -- tokens are in token_vault only.
 */
type ConnectionRow = {
  provider: "facebook" | "instagram" | "gbp";
  status: string | null;
  platform_account_name: string | null;
  display_name: string | null;
  last_synced_at: string | null;
  token_expires_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business",
  gbp: "Google Business Profile",
};

export async function listConnectionSummaries(): Promise<ConnectionSummary[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await supabase
      .from("social_connections")
      .select("provider, status, platform_account_name, display_name, last_synced_at, token_expires_at, expires_at, metadata")
      .eq("account_id", accountId)
      .order("provider")
      .returns<ConnectionRow[]>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return fallbackConnections();
      }
      throw error;
    }

    if (!data?.length) {
      return fallbackConnections();
    }

    return data.map((row) => {
      const evaluation = evaluateConnectionMetadata(row.provider, row.metadata);
      // Prefer token_expires_at (v2); fall back to legacy expires_at for GBP connections
      const effectiveExpiry = row.token_expires_at ?? row.expires_at;
      return {
        provider: row.provider,
        status: deriveStatus(row, evaluation.complete),
        lastSyncedAt: row.last_synced_at ?? undefined,
        expiresAt: effectiveExpiry ?? undefined,
        displayName: row.display_name ?? row.platform_account_name ?? PROVIDER_LABELS[row.provider],
        metadata: row.metadata ?? undefined,
        metadataValid: evaluation.complete,
        metadataMissingKeys: evaluation.missingKeys,
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
  return Object.entries(PROVIDER_LABELS).map(([provider, label]) => ({
    provider: provider as ConnectionSummary["provider"],
    status: "needs_action",
    displayName: label,
    metadataValid: false,
    metadataMissingKeys: [],
  }));
}

function deriveStatus(row: ConnectionRow, metadataComplete: boolean): ConnectionStatus {
  if (!metadataComplete) {
    return "needs_action";
  }
  return (row.status ?? "needs_action") as ConnectionStatus;
}
