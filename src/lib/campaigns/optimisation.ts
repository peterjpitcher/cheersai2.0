import { setMetaObjectStatus } from '@/lib/meta/marketing';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

export type MetaOptimisationMode = 'apply' | 'dry_run';
export type MetaOptimisationActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';

export interface OptimisationAdRow {
  id: string;
  meta_ad_id: string | null;
  name: string;
  status: string;
  meta_status: string | null;
  metrics_spend: number | string | null;
  metrics_impressions: number | string | null;
  metrics_clicks: number | string | null;
  metrics_ctr: number | string | null;
  metrics_cpc: number | string | null;
  metrics_conversions: number | string | null;
  metrics_cost_per_conversion: number | string | null;
  metrics_conversion_rate: number | string | null;
  last_synced_at: string | null;
}

export interface OptimisationAdSetRow {
  id: string;
  meta_adset_id: string | null;
  name: string;
  status: string;
  meta_status: string | null;
  last_synced_at: string | null;
  ads?: OptimisationAdRow[];
}

export interface OptimisationCampaignRow {
  id: string;
  account_id: string;
  meta_campaign_id: string | null;
  name: string;
  status: string;
  meta_status: string | null;
  last_synced_at: string | null;
  ad_sets?: OptimisationAdSetRow[];
}

interface OptimisationAdAccountRow {
  access_token: string | null;
  token_expires_at: string | null;
}

export interface OptimisationDecision {
  campaignId: string;
  adSetId: string;
  adId: string;
  metaAdId: string;
  actionType: 'pause_ad';
  reason: string;
  metricsSnapshot: Record<string, unknown>;
}

export interface MetaCampaignOptimisationResult {
  runId: string;
  evaluatedAdSets: number;
  plannedActions: number;
  appliedActions: number;
  failedActions: number;
}

interface RunMetaCampaignOptimisationOptions {
  accountId: string;
  mode?: MetaOptimisationMode;
  supabase?: SupabaseClientLike;
}

export async function runMetaCampaignOptimisation({
  accountId,
  mode = 'apply',
  supabase: providedSupabase,
}: RunMetaCampaignOptimisationOptions): Promise<MetaCampaignOptimisationResult> {
  const supabase = providedSupabase ?? createServiceSupabaseClient();
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runError } = await supabase
    .from('meta_optimisation_runs')
    .insert({
      account_id: accountId,
      mode,
      status: 'running',
      started_at: startedAt,
      summary: {},
    })
    .select('id')
    .single<{ id: string }>();

  if (runError || !runRow) {
    throw new Error(runError?.message ?? 'Could not start Meta optimisation run.');
  }

  const runId = runRow.id;

  try {
    const { data: adAccount, error: adAccountError } = await supabase
      .from('meta_ad_accounts')
      .select('access_token, token_expires_at')
      .eq('account_id', accountId)
      .single<OptimisationAdAccountRow>();

    if (adAccountError) throw new Error(adAccountError.message);
    if (!adAccount?.access_token) {
      throw new Error('Meta Ads account not connected.');
    }
    if (adAccount.token_expires_at && new Date(adAccount.token_expires_at) < new Date()) {
      throw new Error('Meta Ads token has expired.');
    }

    const { data: campaigns, error: campaignsError } = await supabase
      .from('meta_campaigns')
      .select(
        'id, account_id, meta_campaign_id, name, status, meta_status, last_synced_at, ad_sets(id, meta_adset_id, name, status, meta_status, last_synced_at, ads(id, meta_ad_id, name, status, meta_status, metrics_spend, metrics_impressions, metrics_clicks, metrics_ctr, metrics_cpc, metrics_conversions, metrics_cost_per_conversion, metrics_conversion_rate, last_synced_at))',
      )
      .eq('account_id', accountId)
      .eq('status', 'ACTIVE')
      .not('meta_campaign_id', 'is', null);

    if (campaignsError) throw new Error(campaignsError.message);

    const allCampaigns = Array.isArray(campaigns) ? (campaigns as unknown as OptimisationCampaignRow[]) : [];
    const { decisions, evaluatedAdSets } = evaluateCampaignOptimisation(allCampaigns);

    let appliedActions = 0;
    let failedActions = 0;

    for (const decision of decisions) {
      let actionStatus: MetaOptimisationActionStatus = mode === 'dry_run' ? 'planned' : 'applied';
      let actionError: string | null = null;
      let appliedAt: string | null = null;

      if (mode === 'apply') {
        try {
          await setMetaObjectStatus(decision.metaAdId, adAccount.access_token, 'PAUSED');
          await supabase
            .from('ads')
            .update({ status: 'PAUSED', meta_status: 'PAUSED' })
            .eq('id', decision.adId);
          appliedAt = new Date().toISOString();
          appliedActions++;
        } catch (error) {
          actionStatus = 'failed';
          actionError = error instanceof Error ? error.message : String(error);
          failedActions++;
        }
      }

      await supabase
        .from('meta_optimisation_actions')
        .insert({
          run_id: runId,
          account_id: accountId,
          campaign_id: decision.campaignId,
          adset_id: decision.adSetId,
          ad_id: decision.adId,
          meta_object_id: decision.metaAdId,
          action_type: decision.actionType,
          reason: decision.reason,
          metrics_snapshot: decision.metricsSnapshot,
          status: actionStatus,
          error: actionError,
          applied_at: appliedAt,
        });
    }

    const result: MetaCampaignOptimisationResult = {
      runId,
      evaluatedAdSets,
      plannedActions: decisions.length,
      appliedActions,
      failedActions,
    };

    await supabase
      .from('meta_optimisation_runs')
      .update({
        status: 'completed',
        summary: result,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);

    return result;
  } catch (error) {
    await supabase
      .from('meta_optimisation_runs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
    throw error;
  }
}

export function evaluateCampaignOptimisation(campaigns: OptimisationCampaignRow[]): {
  decisions: OptimisationDecision[];
  evaluatedAdSets: number;
} {
  const decisions: OptimisationDecision[] = [];
  let evaluatedAdSets = 0;

  for (const campaign of campaigns) {
    if (!isActiveObject(campaign) || !campaign.meta_campaign_id || !campaign.last_synced_at) continue;

    const adSets = Array.isArray(campaign.ad_sets) ? campaign.ad_sets : [];
    for (const adSet of adSets) {
      if (!isActiveObject(adSet) || !adSet.meta_adset_id || !adSet.last_synced_at) continue;

      const activeAds = (Array.isArray(adSet.ads) ? adSet.ads : [])
        .filter((ad) => isActiveObject(ad) && Boolean(ad.meta_ad_id) && Boolean(ad.last_synced_at));

      if (activeAds.length < 2) continue;
      evaluatedAdSets++;

      const adSetDecisions = evaluateAdSetOptimisation(campaign, adSet, activeAds);
      let remainingActiveAds = activeAds.length;
      for (const decision of adSetDecisions) {
        if (remainingActiveAds <= 1) break;
        decisions.push(decision);
        remainingActiveAds--;
      }
    }
  }

  return { decisions, evaluatedAdSets };
}

export function evaluateAdSetOptimisation(
  campaign: Pick<OptimisationCampaignRow, 'id' | 'name'>,
  adSet: Pick<OptimisationAdSetRow, 'id' | 'name'>,
  activeAds: OptimisationAdRow[],
): OptimisationDecision[] {
  if (activeAds.length < 2) return [];

  const adsWithBookings = activeAds.filter((ad) => metric(ad.metrics_conversions) >= 1);
  if (adsWithBookings.length > 0) {
    return activeAds
      .filter((ad) => {
        if (metric(ad.metrics_conversions) > 0) return false;
        return metric(ad.metrics_spend) >= 5 || metric(ad.metrics_clicks) >= 15;
      })
      .map((ad) => buildPauseDecision({
        campaign,
        adSet,
        ad,
        reason:
          'Paused because it had no bookings after meaningful spend/click volume while a sibling ad in the ad set had bookings.',
      }));
  }

  const candidates = activeAds
    .filter((ad) => {
      if (metric(ad.metrics_conversions) > 0) return false;
      if (metric(ad.metrics_impressions) < 500) return false;
      if (metric(ad.metrics_spend) < 3) return false;
      if (metric(ad.metrics_ctr) >= 0.5) return false;
      return hasMateriallyStrongerSibling(ad, activeAds);
    })
    .sort((a, b) => {
      const ctrDelta = metric(a.metrics_ctr) - metric(b.metrics_ctr);
      if (ctrDelta !== 0) return ctrDelta;
      return metric(b.metrics_spend) - metric(a.metrics_spend);
    });

  const loser = candidates[0];
  if (!loser) return [];

  return [
    buildPauseDecision({
      campaign,
      adSet,
      ad: loser,
      reason:
        'Paused because it had enough impressions and spend, CTR below 0.5%, and a sibling ad was materially stronger.',
    }),
  ];
}

function buildPauseDecision(args: {
  campaign: Pick<OptimisationCampaignRow, 'id' | 'name'>;
  adSet: Pick<OptimisationAdSetRow, 'id' | 'name'>;
  ad: OptimisationAdRow;
  reason: string;
}): OptimisationDecision {
  return {
    campaignId: args.campaign.id,
    adSetId: args.adSet.id,
    adId: args.ad.id,
    metaAdId: args.ad.meta_ad_id ?? '',
    actionType: 'pause_ad',
    reason: args.reason,
    metricsSnapshot: {
      campaignName: args.campaign.name,
      adSetName: args.adSet.name,
      adName: args.ad.name,
      spend: metric(args.ad.metrics_spend),
      impressions: metric(args.ad.metrics_impressions),
      clicks: metric(args.ad.metrics_clicks),
      ctr: metric(args.ad.metrics_ctr),
      cpc: metric(args.ad.metrics_cpc),
      conversions: metric(args.ad.metrics_conversions),
      costPerConversion: metric(args.ad.metrics_cost_per_conversion),
      conversionRate: metric(args.ad.metrics_conversion_rate),
      lastSyncedAt: args.ad.last_synced_at,
    },
  };
}

function hasMateriallyStrongerSibling(ad: OptimisationAdRow, siblings: OptimisationAdRow[]): boolean {
  const adCtr = metric(ad.metrics_ctr);
  const adClicks = metric(ad.metrics_clicks);
  return siblings.some((sibling) => {
    if (sibling.id === ad.id) return false;
    const siblingCtr = metric(sibling.metrics_ctr);
    const siblingClicks = metric(sibling.metrics_clicks);
    if (adCtr === 0) {
      return siblingCtr >= 0.5 && siblingClicks >= adClicks + 5;
    }
    return siblingCtr >= adCtr * 2 && siblingClicks >= adClicks + 5;
  });
}

function isActiveObject(row: { status: string; meta_status: string | null }): boolean {
  return row.status === 'ACTIVE' && (row.meta_status === null || row.meta_status === 'ACTIVE');
}

function metric(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
