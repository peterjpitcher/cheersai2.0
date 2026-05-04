import { NextResponse } from 'next/server';

import { runMetaCampaignOptimisation } from '@/lib/campaigns/optimisation';
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
  const { data: accounts, error } = await supabase
    .from('meta_ad_accounts')
    .select('account_id')
    .eq('setup_complete', true)
    .neq('access_token', '');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{
    accountId: string;
    evaluatedAdSets?: number;
    plannedActions?: number;
    appliedActions?: number;
    failedActions?: number;
    synced?: number;
    syncFailed?: number;
    error?: string;
  }> = [];

  for (const account of accounts ?? []) {
    const accountId = typeof account.account_id === 'string' ? account.account_id : '';
    if (!accountId) continue;

    try {
      const { synced, failed } = await syncAccountCampaignPerformance(supabase, accountId);
      const result = await runMetaCampaignOptimisation({
        accountId,
        mode: 'recommend',
        supabase,
      });
      results.push({
        accountId,
        synced,
        syncFailed: failed,
        evaluatedAdSets: result.evaluatedAdSets,
        plannedActions: result.plannedActions,
        appliedActions: result.appliedActions,
        failedActions: result.failedActions,
      });
    } catch (err) {
      console.error(`[optimise-meta-campaigns] Failed for account ${accountId}:`, err);
      results.push({
        accountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    accounts: results.length,
    results,
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function syncAccountCampaignPerformance(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
) {
  const { data: campaigns } = await supabase
    .from('meta_campaigns')
    .select('id')
    .eq('account_id', accountId)
    .not('meta_campaign_id', 'is', null)
    .in('status', ['ACTIVE', 'PAUSED']);

  let synced = 0;
  let failed = 0;
  for (const campaign of campaigns ?? []) {
    try {
      await syncMetaCampaignPerformance(campaign.id, { accountId, supabase });
      synced++;
    } catch (error) {
      failed++;
      console.error(`[optimise-meta-campaigns] Performance sync failed for ${campaign.id}:`, error);
    }
  }

  return { synced, failed };
}
