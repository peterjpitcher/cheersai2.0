import { NextResponse } from 'next/server';

import {
  buildUpsertRow,
  fetchGbpReviews,
  refreshGoogleAccessToken,
  resolveCanonicalLocationId,
} from '@/lib/gbp/reviews';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

function normaliseAuthHeader(value: string | null) {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const xCronSecret = request.headers.get('x-cron-secret')?.trim();
  const authHeader = request.headers.get('authorization');
  const headerSecret = xCronSecret || normaliseAuthHeader(authHeader);
  const urlSecret = new URL(request.url).searchParams.get('secret')?.trim() ?? '';

  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();

  // Fetch all active GBP connections
  const { data: connections } = await supabase
    .from('social_connections')
    .select('account_id, access_token, refresh_token, expires_at, metadata')
    .eq('provider', 'gbp')
    .eq('status', 'active')
    .returns<{
      account_id: string;
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
      metadata: Record<string, unknown> | null;
    }[]>();

  if (!connections?.length) {
    return NextResponse.json({ synced: 0, accounts: 0 });
  }

  let totalSynced = 0;

  for (const conn of connections) {
    if (!conn.access_token || !conn.refresh_token) continue;
    const locationId = conn.metadata?.locationId as string | undefined;
    if (!locationId) continue;

    try {
      let token = conn.access_token;

      // Refresh if needed
      const isExpired =
        conn.expires_at && new Date(conn.expires_at) < new Date(Date.now() + 5 * 60 * 1000);
      if (isExpired) {
        const refreshed = await refreshGoogleAccessToken(conn.refresh_token);
        token = refreshed.accessToken;
        await supabase
          .from('social_connections')
          .update({ access_token: token, expires_at: refreshed.expiresAt })
          .eq('account_id', conn.account_id)
          .eq('provider', 'gbp');
      }

      // Resolve canonical ID once and write back to DB so future cron runs skip resolution
      const canonicalLocationId = await resolveCanonicalLocationId(locationId, token);
      if (canonicalLocationId !== locationId) {
        supabase
          .from('social_connections')
          .update({ metadata: { locationId: canonicalLocationId } })
          .eq('account_id', conn.account_id)
          .eq('provider', 'gbp')
          .then(({ error }) => {
            if (error) console.error(`[sync-gbp-reviews] write-back failed for ${conn.account_id}:`, error.message);
          });
      }

      const reviews = await fetchGbpReviews(canonicalLocationId, token);
      if (!reviews.length) continue;

      const rows = reviews.map((r) => buildUpsertRow(conn.account_id, r));
      await supabase
        .from('gbp_reviews')
        .upsert(rows, { onConflict: 'business_profile_id,google_review_id', ignoreDuplicates: false });

      totalSynced += rows.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('RATE_LIMITED:')) {
        // Rate limit is transient — log as warning and continue to next account
        console.warn(`[sync-gbp-reviews] Rate limited for account ${conn.account_id}:`, message);
      } else {
        console.error(`[sync-gbp-reviews] Failed for account ${conn.account_id}:`, err);
      }
    }
  }

  return NextResponse.json({ synced: totalSynced, accounts: connections.length });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
