/**
 * Connection health derivation — determines green/amber/red status
 * per D-01 design requirement and PLAT-06 token health alerting.
 *
 * Green: active connection, token not near expiry
 * Amber: token expires within 7 days, or unknown expiry on non-Facebook
 * Red: expired, disconnected, needs_action, revoked, or token past expiry
 */

import type { ConnectionHealth, ConnectionHealthSummary, ProviderPlatform } from '@/types/providers';
import { requireAuthContext } from '@/lib/auth/server';

const EXPIRY_WARNING_DAYS = 7;
const EXPIRY_WARNING_MS = EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;

/**
 * Facebook page tokens don't expire (Research pitfall 3).
 * A null token_expires_at for these platforms means "indefinite", not "unknown".
 */
const NEVER_EXPIRING_PLATFORMS: ProviderPlatform[] = ['facebook'];

/**
 * Derive the health status of a connection based on its status and token expiry.
 *
 * Rules:
 * - Red: disconnected, expired, or token already past expiry
 * - Amber: token expires within 7 days, or unknown expiry on non-Facebook platforms
 * - Green: active and token not near expiry, or Facebook with null expiry
 */
export function deriveConnectionHealth(
  status: string,
  tokenExpiresAt: string | null,
  platform: ProviderPlatform,
): ConnectionHealth {
  // Red: disconnected or expired status
  if (status === 'disconnected' || status === 'expired' || status === 'revoked' || status === 'needs_action') {
    return 'red';
  }

  // If no expiry date:
  // - Facebook page tokens don't expire -> green
  // - Others -> amber (unknown expiry is a warning per PLAT-06)
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
  const { supabase, accountId } = await requireAuthContext();

  const { data, error } = await supabase
    .from('social_connections')
    .select('id, provider, platform_account_name, status, token_expires_at, expires_at, last_synced_at')
    .eq('account_id', accountId)
    .order('provider');

  if (error) throw error;
  if (!data?.length) return [];

  return data.map((row: {
    id: string;
    provider: string;
    platform_account_name: string | null;
    status: string;
    token_expires_at: string | null;
    expires_at: string | null;
    last_synced_at: string | null;
  }) => {
    // Prefer token_expires_at (v2); fall back to legacy expires_at for GBP connections
    const effectiveExpiry = row.token_expires_at ?? row.expires_at;
    return {
      provider: row.provider as ProviderPlatform,
      health: deriveConnectionHealth(row.status, effectiveExpiry, row.provider as ProviderPlatform),
      accountName: row.platform_account_name ?? null,
      lastSyncedAt: row.last_synced_at ?? null,
      tokenExpiresAt: effectiveExpiry,
      connectionId: row.id,
    };
  });
}
