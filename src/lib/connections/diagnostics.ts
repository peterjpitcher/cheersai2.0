import { requireAuthContext } from "@/lib/auth/server";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export interface ConnectionDiagnostic {
  provider: "facebook" | "instagram" | "gbp";
  status: "active" | "expiring" | "needs_action";
  displayName: string | null;
  accessTokenPreview: string | null;
  refreshTokenPreview: string | null;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown> | null;
}

type ConnectionRow = {
  provider: "facebook" | "instagram" | "gbp";
  status: string | null;
  display_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  last_synced_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
};

export async function listConnectionDiagnostics(): Promise<ConnectionDiagnostic[]> {
  const { accountId } = await requireAuthContext();
  const supabase = tryCreateServiceSupabaseClient();

  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("social_connections")
      .select(
        "provider, status, display_name, access_token, refresh_token, expires_at, last_synced_at, updated_at, metadata",
      )
      .eq("account_id", accountId)
      .order("provider")
      .returns<ConnectionRow[]>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return [];
      }
      throw error;
    }

    return (data ?? []).map((row) => ({
      provider: row.provider,
      status: normaliseStatus(row.status),
      displayName: row.display_name,
      accessTokenPreview: maskSecret(row.access_token),
      refreshTokenPreview: maskSecret(row.refresh_token),
      expiresAt: row.expires_at,
      lastSyncedAt: row.last_synced_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ?? null,
    }));
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}

function normaliseStatus(status: string | null | undefined): ConnectionDiagnostic["status"] {
  if (status === "active" || status === "expiring" || status === "needs_action") {
    return status;
  }
  return "needs_action";
}

function maskSecret(secret: string | null | undefined) {
  if (!secret) return null;
  const trimmed = secret.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
