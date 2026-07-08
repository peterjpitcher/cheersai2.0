import { NextResponse } from 'next/server';

import { runMetaCampaignOptimisation } from '@/lib/campaigns/optimisation';
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

  // Surface a failure status to the scheduler/monitor when there was work to do but every
  // account errored — otherwise a fully-broken run (expired token, schema gap) looks healthy.
  const erroredAccounts = results.filter((result) => result.error).length;
  const allFailed = results.length > 0 && erroredAccounts === results.length;
  return NextResponse.json(
    { accounts: results.length, results },
    { status: allFailed ? 500 : 200 },
  );
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
