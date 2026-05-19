/**
 * Nightly token health cron endpoint (PLAT-10).
 * Called by QStash on a nightly schedule.
 * Checks all social_connections, derives health, and updates expired statuses.
 */

import { NextResponse } from 'next/server';

import { deriveConnectionHealth } from '@/lib/connections/health';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import type { ProviderPlatform } from '@/types/providers';

export const dynamic = 'force-dynamic';

type ConnectionRow = {
  id: string;
  account_id: string;
  platform: string;
  status: string;
  token_expires_at: string | null;
  platform_account_name: string | null;
};

/**
 * Normalise auth header by stripping "Bearer " prefix.
 */
function normaliseAuthHeader(value: string | null): string {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

/**
 * Core logic: check all connections and update expired statuses.
 */
async function checkTokenHealth(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    return {
      status: 500,
      body: { error: 'Supabase service role is not configured' },
    };
  }

  // Fetch all non-revoked connections across all accounts
  const { data: connections, error: queryError } = await service
    .from('social_connections')
    .select('id, account_id, platform, status, token_expires_at, platform_account_name')
    .neq('status', 'revoked')
    .returns<ConnectionRow[]>();

  if (queryError) {
    return {
      status: 500,
      body: { error: 'Failed to query social_connections', message: queryError.message },
    };
  }

  if (!connections || connections.length === 0) {
    return {
      status: 200,
      body: { checked: 0, healthy: 0, warning: 0, expired: 0 },
    };
  }

  let healthy = 0;
  let warning = 0;
  let expired = 0;

  for (const conn of connections) {
    const health = deriveConnectionHealth(
      conn.status,
      conn.token_expires_at,
      conn.platform as ProviderPlatform,
    );

    switch (health) {
      case 'green':
        healthy++;
        break;

      case 'amber':
        warning++;
        console.warn(
          `[token-health] Warning: ${conn.platform} connection ${conn.id} ` +
          `(${conn.platform_account_name ?? 'unknown'}) token expiring soon`,
        );
        break;

      case 'red':
        expired++;
        // Update status to 'expired' if not already marked
        if (conn.status !== 'expired' && conn.status !== 'disconnected') {
          const { error: updateError } = await service
            .from('social_connections')
            .update({ status: 'expired' })
            .eq('id', conn.id);

          if (updateError) {
            console.error(
              `[token-health] Failed to update connection ${conn.id} to expired:`,
              updateError.message,
            );
          } else {
            console.warn(
              `[token-health] Marked ${conn.platform} connection ${conn.id} as expired`,
            );
          }
        }
        break;
    }
  }

  const summary = {
    checked: connections.length,
    healthy,
    warning,
    expired,
  };

  console.log('[token-health] Nightly check complete:', JSON.stringify(summary));

  return { status: 200, body: summary };
}

/**
 * Handle incoming request with CRON_SECRET validation.
 * Follows the same pattern as notify-expiring-connections cron.
 */
async function handle(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const xCronSecret = request.headers.get('x-cron-secret')?.trim();
  const authHeader = normaliseAuthHeader(request.headers.get('authorization'));
  const headerSecret = xCronSecret || authHeader;
  const urlSecret = new URL(request.url).searchParams.get('secret')?.trim();

  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await checkTokenHealth();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
