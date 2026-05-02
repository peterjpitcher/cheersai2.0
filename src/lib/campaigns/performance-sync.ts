import { fetchMetaObjectInsights, type CampaignInsights } from '@/lib/meta/marketing';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

interface SyncAdRow {
  id: string;
  meta_ad_id: string | null;
}

interface SyncAdSetRow {
  id: string;
  meta_adset_id: string | null;
  ads?: SyncAdRow[];
}

interface SyncCampaignRow {
  id: string;
  account_id: string;
  meta_campaign_id: string | null;
  start_date: string;
  end_date: string | null;
  ad_sets?: SyncAdSetRow[];
}

interface SyncAdAccountRow {
  access_token: string | null;
  token_expires_at: string | null;
}

export interface CampaignPerformanceSyncResult {
  campaignSynced: boolean;
  adSetsSynced: number;
  adsSynced: number;
}

export async function syncMetaCampaignPerformance(
  campaignId: string,
  options?: {
    accountId?: string;
    supabase?: SupabaseClientLike;
  },
): Promise<CampaignPerformanceSyncResult> {
  const supabase = options?.supabase ?? createServiceSupabaseClient();
  let campaignQuery = supabase
    .from('meta_campaigns')
    .select('id, account_id, meta_campaign_id, start_date, end_date, ad_sets(id, meta_adset_id, ads(id, meta_ad_id))')
    .eq('id', campaignId);

  if (options?.accountId) {
    campaignQuery = campaignQuery.eq('account_id', options.accountId);
  }

  const { data: campaign, error: campaignError } = await campaignQuery.maybeSingle<SyncCampaignRow>();

  if (campaignError) {
    throw new Error(campaignError.message);
  }
  if (!campaign) {
    throw new Error('Campaign not found.');
  }
  if (!campaign.meta_campaign_id) {
    throw new Error('Publish this campaign before syncing performance.');
  }

  const { data: adAccount, error: adAccountError } = await supabase
    .from('meta_ad_accounts')
    .select('access_token, token_expires_at')
    .eq('account_id', campaign.account_id)
    .single<SyncAdAccountRow>();

  if (adAccountError) {
    throw new Error(adAccountError.message);
  }
  if (!adAccount?.access_token) {
    throw new Error('Meta Ads account not connected. Please reconnect in Connections.');
  }
  if (adAccount.token_expires_at && new Date(adAccount.token_expires_at) < new Date()) {
    throw new Error('Your Meta Ads token has expired. Please reconnect your Meta Ads account in Connections.');
  }

  const dateRange = buildInsightsDateRange(campaign.start_date, campaign.end_date);
  const syncedAt = new Date().toISOString();
  const campaignInsights = await fetchMetaObjectInsights(campaign.meta_campaign_id, adAccount.access_token, dateRange);

  await updatePerformanceMetrics(supabase, 'meta_campaigns', campaign.id, campaignInsights, syncedAt);

  let adSetsSynced = 0;
  let adsSynced = 0;
  const adSets = Array.isArray(campaign.ad_sets) ? campaign.ad_sets : [];

  for (const adSet of adSets) {
    if (adSet.meta_adset_id) {
      const adSetInsights = await fetchMetaObjectInsights(adSet.meta_adset_id, adAccount.access_token, dateRange);
      await updatePerformanceMetrics(supabase, 'ad_sets', adSet.id, adSetInsights, syncedAt);
      adSetsSynced++;
    }

    const ads = Array.isArray(adSet.ads) ? adSet.ads : [];
    for (const ad of ads) {
      if (!ad.meta_ad_id) continue;
      const adInsights = await fetchMetaObjectInsights(ad.meta_ad_id, adAccount.access_token, dateRange);
      await updatePerformanceMetrics(supabase, 'ads', ad.id, adInsights, syncedAt);
      adsSynced++;
    }
  }

  return {
    campaignSynced: true,
    adSetsSynced,
    adsSynced,
  };
}

async function updatePerformanceMetrics(
  supabase: SupabaseClientLike,
  table: 'meta_campaigns' | 'ad_sets' | 'ads',
  id: string,
  insights: CampaignInsights,
  syncedAt: string,
) {
  const { error } = await supabase
    .from(table)
    .update(buildMetricsUpdate(insights, syncedAt))
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }
}

function buildMetricsUpdate(insights: CampaignInsights, syncedAt: string) {
  return {
    meta_status: insights.status,
    metrics_spend: insights.spend,
    metrics_impressions: insights.impressions,
    metrics_reach: insights.reach,
    metrics_clicks: insights.clicks,
    metrics_ctr: insights.ctr,
    metrics_cpc: insights.cpc,
    last_synced_at: syncedAt,
  };
}

function buildInsightsDateRange(startDate: string, endDate: string | null): { since: string; until: string } {
  const today = new Date().toISOString().slice(0, 10);
  const until = endDate && endDate < today ? endDate : today;

  return {
    since: startDate <= until ? startDate : until,
    until,
  };
}
