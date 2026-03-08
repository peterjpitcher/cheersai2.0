import { NextResponse } from 'next/server';
import { fetchCampaignInsights } from '@/lib/meta/marketing';
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

  // Fetch all active/paused campaigns that have been published (have meta_campaign_id)
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, meta_campaign_id, account_id')
    .not('meta_campaign_id', 'is', null)
    .in('status', ['ACTIVE', 'PAUSED']);

  if (!campaigns?.length) {
    return NextResponse.json({ synced: 0 });
  }

  let synced = 0;

  for (const campaign of campaigns) {
    try {
      // Fetch access token for this account
      const { data: adAccount } = await supabase
        .from('meta_ad_accounts')
        .select('access_token, token_expires_at')
        .eq('account_id', campaign.account_id)
        .single();

      if (!adAccount?.access_token) continue;

      // Skip if token expired
      if (adAccount.token_expires_at && new Date(adAccount.token_expires_at) < new Date()) {
        continue;
      }

      const insights = await fetchCampaignInsights(
        campaign.meta_campaign_id!,
        adAccount.access_token,
      );

      await supabase
        .from('campaigns')
        .update({
          meta_status: insights.status,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      synced++;
    } catch (err) {
      console.error(`[sync-meta-campaigns] Failed for campaign ${campaign.id}:`, err);
      // Continue to next campaign on error
    }
  }

  return NextResponse.json({ synced });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
