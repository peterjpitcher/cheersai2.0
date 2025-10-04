import { OWNER_ACCOUNT_ID } from "@/lib/constants";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { ensureOwnerAccount } from "@/lib/supabase/owner";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
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

type ConnectionRow = {
  provider: "facebook" | "instagram" | "gbp";
  status: ConnectionStatus | null;
  display_name: string | null;
  last_synced_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business",
  gbp: "Google Business Profile",
};

export async function listConnectionSummaries(): Promise<ConnectionSummary[]> {
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("social_connections")
      .select("provider, status, display_name, last_synced_at, expires_at, metadata")
      .eq("account_id", OWNER_ACCOUNT_ID)
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
      return {
        provider: row.provider,
        status: deriveStatus(row, evaluation.complete),
        lastSyncedAt: row.last_synced_at ?? undefined,
        expiresAt: row.expires_at ?? undefined,
        displayName: row.display_name ?? PROVIDER_LABELS[row.provider],
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
