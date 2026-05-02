import { NextResponse } from 'next/server';
import { syncMetaCampaignPerformance } from '@/lib/campaigns/performance-sync';
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
    .from('meta_campaigns')
    .select('id')
    .not('meta_campaign_id', 'is', null)
    .in('status', ['ACTIVE', 'PAUSED']);

  if (!campaigns?.length) {
    return NextResponse.json({ synced: 0 });
  }

  let synced = 0;

  for (const campaign of campaigns) {
    try {
      await syncMetaCampaignPerformance(campaign.id, { supabase });
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
