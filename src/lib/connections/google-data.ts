/**
 * What the Google card on the Connections page shows. Kept apart from
 * ./data.ts, which stays Facebook and Instagram only.
 *
 * Returns null for a brand without the googlePosts switch (decision D10), so
 * that brand never sees Google at all, even if a Google row is stored.
 */

import { requireAuthContext } from "@/lib/auth/server";
import { activeBrandHasGooglePosts } from "@/lib/connections/google-access";
import { GOOGLE_PROVIDER } from "@/lib/connections/google-messages";
import { isGoogleConfigured } from "@/lib/connections/google-oauth";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import {
  deriveConnectionReadiness,
  type ConnectionReadinessIssue,
  type ConnectionStatus,
} from "@/lib/connections/readiness";

export interface GoogleConnectionSummary {
  /** The Google OAuth client is present in the environment. */
  configured: boolean;
  /** A Google row exists for this brand (connected now or in the past). */
  connected: boolean;
  status: ConnectionStatus;
  ready: boolean;
  /** The chosen location's title; null when nothing is connected. */
  locationTitle: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  issues: ConnectionReadinessIssue[];
}

interface GoogleRow {
  id: string;
  status: string | null;
  platform_account_name: string | null;
  token_expires_at: string | null;
  metadata: Record<string, unknown> | null;
}

export async function getGoogleConnectionSummary(): Promise<GoogleConnectionSummary | null> {
  const ctx = await requireAuthContext();
  if (!activeBrandHasGooglePosts(ctx)) {
    return null;
  }
  const { supabase, accountId } = ctx;
  const configured = isGoogleConfigured();

  const { data: row, error } = await supabase
    .from("social_connections")
    .select("id, status, platform_account_name, token_expires_at, metadata")
    .eq("account_id", accountId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle<GoogleRow>();

  if (error) throw error;

  if (!row) {
    const readiness = deriveConnectionReadiness({
      provider: GOOGLE_PROVIDER,
      storedStatus: "needs_action",
      metadataComplete: false,
      hasAccessToken: false,
      expiresAt: null,
      connected: false,
    });
    return {
      configured,
      connected: false,
      status: readiness.status,
      ready: false,
      locationTitle: null,
      hasAccessToken: false,
      hasRefreshToken: false,
      issues: readiness.issues,
    };
  }

  // token_vault has no account_id; the connection id above is already brand-scoped.
  const { data: vaultRows, error: vaultError } = await supabase
    .from("token_vault")
    .select("token_type")
    .eq("social_connection_id", row.id);

  if (vaultError) throw vaultError;

  const stored = new Set(((vaultRows ?? []) as Array<{ token_type: string }>).map((entry) => entry.token_type));
  const hasAccessToken = stored.has("access");
  const hasRefreshToken = stored.has("refresh");
  const evaluation = evaluateConnectionMetadata(GOOGLE_PROVIDER, row.metadata);
  const readiness = deriveConnectionReadiness({
    provider: GOOGLE_PROVIDER,
    storedStatus: row.status,
    metadataComplete: evaluation.complete,
    hasAccessToken,
    hasRefreshToken,
    expiresAt: row.token_expires_at,
  });
  const title = typeof row.metadata?.locationTitle === "string" ? row.metadata.locationTitle : row.platform_account_name;

  return {
    configured,
    connected: true,
    status: readiness.status,
    ready: readiness.ready,
    locationTitle: title ?? null,
    hasAccessToken,
    hasRefreshToken,
    issues: readiness.issues,
  };
}
