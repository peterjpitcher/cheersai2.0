/**
 * Nightly cron endpoint for GBP metrics collection (ANLY-04).
 * Scheduled for 02:00 UTC via Vercel cron config.
 *
 * Fetches daily location metrics from the GBP Performance API
 * for all connected GBP accounts and stores in gbp_daily_metrics.
 *
 * Date window: today minus 5 days to today minus 3 days (accounts for
 * GBP 2-3 day data delay).
 */

import { NextResponse } from 'next/server';

import { fetchGbpDailyMetrics, storeGbpDailyMetrics } from '@/lib/gbp/metrics';
import { ensureFreshGbpToken } from '@/lib/providers/gbp/token-refresh';
import { getConnectionMetadata } from '@/lib/providers/shared';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type GbpConnectionRow = {
  id: string;
  account_id: string;
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
 * Calculate date range for GBP metrics fetch.
 * GBP data has a 2-3 day delay, so we fetch from (today - 5) to (today - 3).
 */
function getGbpDateRange(): { startDate: string; endDate: string } {
  const now = new Date();

  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 5);

  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 3);

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

/**
 * POST handler for GBP metrics cron job.
 * Validates CRON_SECRET, fetches metrics for all GBP connections,
 * and upserts into gbp_daily_metrics.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // ── Auth: validate CRON_SECRET ──
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

  // ── Init Supabase service client ──
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    return NextResponse.json(
      { error: 'Supabase service role is not configured' },
      { status: 500 },
    );
  }

  // ── Fetch all connected GBP social_connections ──
  const { data: connections, error: queryError } = await service
    .from('social_connections')
    .select('id, account_id, platform_account_name')
    .eq('platform', 'gbp')
    .eq('status', 'connected')
    .returns<GbpConnectionRow[]>();

  if (queryError) {
    return NextResponse.json(
      { error: 'Failed to query GBP connections', message: queryError.message },
      { status: 500 },
    );
  }

  if (!connections || connections.length === 0) {
    return NextResponse.json({
      connectionsProcessed: 0,
      metricsStored: 0,
      errors: [],
    });
  }

  const dateRange = getGbpDateRange();
  let metricsStored = 0;
  const errors: string[] = [];

  // ── Process each GBP connection ──
  for (const conn of connections) {
    try {
      // Refresh access token via just-in-time refresh (PLAT-05)
      const accessToken = await ensureFreshGbpToken(conn.id);

      // Get location name from connection metadata
      const metadata = await getConnectionMetadata(conn.id);
      const locationName = metadata.locationId as string;

      if (!locationName) {
        errors.push(`Connection ${conn.id} (${conn.platform_account_name ?? 'unknown'}): no locationId in metadata`);
        continue;
      }

      // Fetch metrics from GBP Performance API
      const { metrics, raw } = await fetchGbpDailyMetrics(accessToken, locationName, dateRange);

      if (metrics.length > 0) {
        // Store in database
        await storeGbpDailyMetrics(conn.account_id, conn.id, metrics, raw);
        metricsStored += metrics.length;
      }

      console.log(
        `[gbp-metrics] Processed ${conn.platform_account_name ?? conn.id}: ${metrics.length} daily metrics stored`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[gbp-metrics] Error processing connection ${conn.id}:`, message);
      errors.push(`Connection ${conn.id} (${conn.platform_account_name ?? 'unknown'}): ${message}`);
    }
  }

  const summary = {
    connectionsProcessed: connections.length,
    metricsStored,
    errors,
  };

  console.log('[gbp-metrics] Nightly GBP metrics collection complete:', JSON.stringify(summary));

  return NextResponse.json(summary);
}
