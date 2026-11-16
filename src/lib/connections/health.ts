/**
 * Connection health derivation — determines green/amber/red status
 * per D-01 design requirement and PLAT-06 token health alerting.
 *
 * Green: active connection, token not near expiry
 * Amber: token expires within 7 days, or unknown expiry on providers that return expiring tokens
 * Red: expired, disconnected, needs_action, revoked, or token past expiry
 */

import type {
  ConnectionHealth,
  ConnectionHealthProvider,
  ConnectionHealthSummary,
  ProviderPlatform,
} from '@/types/providers';
import { requireAuthContext } from '@/lib/auth/server';
import { activeBrandHasGooglePosts } from '@/lib/connections/google-access';

const EXPIRY_WARNING_DAYS = 7;
const EXPIRY_WARNING_MS = EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;

/**
 * Facebook page tokens don't expire (Research pitfall 3). Instagram publishing
 * via Facebook Login uses the same Page token model.
 * A null token_expires_at for these platforms means "indefinite", not "unknown".
 */
const NEVER_EXPIRING_PLATFORMS: ProviderPlatform[] = ['facebook', 'instagram'];

/**
 * Derive the health status of a connection based on its status and token expiry.
 *
 * Rules:
 * - Red: disconnected, expired, or token already past expiry
 * - Amber: token expires within 7 days, or unknown expiry on providers with expiring tokens
 * - Green: active and not near expiry, or Page-token platforms with null expiry
 * - Google ('gbp'): its access token lasts an hour and is renewed from the
 *   stored refresh token, so expiry is ignored: green with a refresh token,
 *   red without one
 */
export function deriveConnectionHealth(
  status: string,
  tokenExpiresAt: string | null,
  platform: ConnectionHealthProvider,
  options: { hasRefreshToken?: boolean } = {},
): ConnectionHealth {
  // Red: disconnected or expired status
  if (status === 'disconnected' || status === 'expired' || status === 'revoked' || status === 'needs_action') {
    return 'red';
  }

  if (platform === 'gbp') {
    return options.hasRefreshToken ? 'green' : 'red';
  }

  if (!tokenExpiresAt) {
    return NEVER_EXPIRING_PLATFORMS.includes(platform) ? 'green' : 'amber';
  }

  const expiresAtMs = new Date(tokenExpiresAt).getTime();
  const now = Date.now();

  // Red: token already expired
  if (expiresAtMs <= now) return 'red';

  // Amber: within 7-day warning window
  if ((expiresAtMs - now) <= EXPIRY_WARNING_MS) return 'amber';

  // Green: active and not near expiry
  return 'green';
}

/**
 * Fetch all connections for the current account and derive health summaries.
 * Returns an array of ConnectionHealthSummary with green/amber/red status.
 */
export async function getConnectionHealthSummaries(): Promise<ConnectionHealthSummary[]> {
  const ctx = await requireAuthContext();
  const { supabase, accountId } = ctx;

  const { data, error } = await supabase
    .from('social_connections')
    .select('id, provider, platform_account_name, status, token_expires_at, expires_at, last_synced_at')
    .eq('account_id', accountId)
    .order('provider');

  if (error) throw error;
  if (!data?.length) return [];

  type HealthRow = {
    id: string;
    provider: string;
    platform_account_name: string | null;
    status: string;
    token_expires_at: string | null;
    expires_at: string | null;
    last_synced_at: string | null;
  };

  // Google is for brands with the googlePosts switch only (decision D10): for
  // every other brand a stored Google row is not shown anywhere.
  const rows = (data as HealthRow[]).filter((row) => row.provider !== 'gbp' || activeBrandHasGooglePosts(ctx));
  const googleIds = rows.filter((row) => row.provider === 'gbp').map((row) => row.id);
  const withRefreshToken = new Set<string>();
  if (googleIds.length) {
    const { data: vaultRows, error: vaultError } = await supabase
      .from('token_vault')
      .select('social_connection_id')
      .in('social_connection_id', googleIds)
      .eq('token_type', 'refresh');
    if (vaultError) throw vaultError;
    for (const row of (vaultRows ?? []) as Array<{ social_connection_id: string | null }>) {
      if (row.social_connection_id) withRefreshToken.add(row.social_connection_id);
    }
  }

  return rows.map((row) => {
    // Prefer token_expires_at (v2); fall back to legacy expires_at column
    const effectiveExpiry = row.token_expires_at ?? row.expires_at;
    return {
      provider: row.provider as ConnectionHealthProvider,
      health: deriveConnectionHealth(row.status, effectiveExpiry, row.provider as ConnectionHealthProvider, {
        hasRefreshToken: withRefreshToken.has(row.id),
      }),
      accountName: row.platform_account_name ?? null,
      lastSyncedAt: row.last_synced_at ?? null,
      tokenExpiresAt: effectiveExpiry,
      connectionId: row.id,
    };
  });
}
