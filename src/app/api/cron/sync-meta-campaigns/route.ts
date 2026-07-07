import { NextResponse } from 'next/server';
import { syncMetaCampaignPerformance } from '@/lib/campaigns/performance-sync';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { verifyCronAuth } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  const supabase = createServiceSupabaseClient();

  // Fetch all active/paused campaigns that have been published (have meta_campaign_id)
  const { data: campaigns } = await supabase
    .from('meta_campaigns')
    .select('id')
    .not('meta_campaign_id', 'is', null)
    .in('status', ['ACTIVE', 'PAUSED']);

  if (!campaigns?.length) {
    return NextResponse.json({ synced: 0 });
  }

  let synced = 0;
  const failedCampaignIds: string[] = [];

  for (const campaign of campaigns) {
    try {
      await syncMetaCampaignPerformance(campaign.id, { supabase });
      synced++;
    } catch (err) {
      console.error(`[sync-meta-campaigns] Failed for campaign ${campaign.id}:`, err);
      failedCampaignIds.push(campaign.id);
      // Continue to next campaign on error
    }
  }

  return NextResponse.json({ synced, failed: failedCampaignIds.length, failedCampaignIds });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
