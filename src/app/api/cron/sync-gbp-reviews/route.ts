import { NextResponse } from 'next/server';

import { GbpRateLimitError } from '@/lib/gbp/business-info';
import { isCanonicalGbpLocationId } from '@/lib/gbp/location-id';
import {
  buildUpsertRow,
  fetchGbpReviews,
  refreshGoogleAccessToken,
} from '@/lib/gbp/reviews';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { verifyCronAuth } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
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
    if (!isCanonicalGbpLocationId(locationId)) {
      console.warn(`[sync-gbp-reviews] Skipping non-canonical location ID for account ${conn.account_id}:`, locationId);
      continue;
    }

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

      const reviews = await fetchGbpReviews(locationId, token);
      if (!reviews.length) continue;

      const rows = reviews.map((r) => buildUpsertRow(conn.account_id, r));
      await supabase
        .from('gbp_reviews')
        .upsert(rows, { onConflict: 'business_profile_id,google_review_id', ignoreDuplicates: false });

      totalSynced += rows.length;
    } catch (err) {
      if (err instanceof GbpRateLimitError) {
        console.warn(`[sync-gbp-reviews] Rate limited for account ${conn.account_id}:`, err.googleDetail);
        break;
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
