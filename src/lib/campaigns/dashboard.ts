import {
  sortAdSetsByStartDate,
  sortAdsByPerformance,
} from '@/lib/campaigns/performance-matrix';
import type {
  Ad,
  AdSet,
  Campaign,
  CampaignPerformanceMetrics,
  OptimisationActionSummary,
} from '@/types/campaigns';

export type DashboardAttentionSeverity = 'critical' | 'warning' | 'info';

export interface CampaignDashboardAttentionItem {
  id: string;
  campaignId: string;
  campaignName: string;
  title: string;
  detail: string;
  severity: DashboardAttentionSeverity;
  href: string;
}

export interface CampaignDashboardAdSummary {
  id: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  name: string;
  headline: string;
  status: string;
  metaStatus: string | null;
  performance: CampaignPerformanceMetrics;
  lastSyncedAt: Date | null;
}

export interface CampaignDashboardCampaign extends Campaign {
  adSets: AdSet[];
  topAd: CampaignDashboardAdSummary | null;
  attentionItems: CampaignDashboardAttentionItem[];
}

export interface CampaignDashboardModel {
  totals: CampaignPerformanceMetrics & {
    campaigns: number;
    activeCampaigns: number;
    draftCampaigns: number;
    pausedCampaigns: number;
  };
  campaigns: CampaignDashboardCampaign[];
  attentionItems: CampaignDashboardAttentionItem[];
  bestAds: CampaignDashboardAdSummary[];
  optimisationActions: OptimisationActionSummary[];
}

const EMPTY_PERFORMANCE: CampaignPerformanceMetrics = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  ctr: 0,
  cpc: 0,
  conversions: 0,
  costPerConversion: 0,
  conversionRate: 0,
};

export function buildCampaignDashboard(
  campaigns: Campaign[],
  optimisationActions: OptimisationActionSummary[] = [],
): CampaignDashboardModel {
  const dashboardCampaigns = campaigns.map((campaign) => {
    const adSets = sortAdSetsByStartDate(campaign.adSets ?? []);
    const adSummaries = flattenCampaignAds({ ...campaign, adSets });
    const sortedAds = sortAdsByPerformance(adSummaries);
    const attentionItems = buildCampaignAttentionItems(campaign);

    return {
      ...campaign,
      adSets,
      topAd: sortedAds[0] ?? null,
      attentionItems,
    };
  });

  const bestAds = sortAdsByPerformance(
    dashboardCampaigns.flatMap((campaign) => flattenCampaignAds(campaign)),
  ).slice(0, 8);
  const attentionItems = dashboardCampaigns.flatMap((campaign) => campaign.attentionItems);

  return {
    totals: buildDashboardTotals(campaigns),
    campaigns: dashboardCampaigns,
    attentionItems,
    bestAds,
    optimisationActions,
  };
}

function buildDashboardTotals(campaigns: Campaign[]): CampaignDashboardModel['totals'] {
  const totals = campaigns.reduce((acc, campaign) => addPerformance(acc, campaign.performance), {
    ...EMPTY_PERFORMANCE,
  });

  return {
    ...totals,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    costPerConversion: totals.conversions > 0 ? totals.spend / totals.conversions : 0,
    conversionRate: totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0,
    campaigns: campaigns.length,
    activeCampaigns: campaigns.filter((campaign) => campaign.status === 'ACTIVE').length,
    draftCampaigns: campaigns.filter((campaign) => campaign.status === 'DRAFT').length,
    pausedCampaigns: campaigns.filter((campaign) => campaign.status === 'PAUSED').length,
  };
}

function buildCampaignAttentionItems(campaign: Campaign): CampaignDashboardAttentionItem[] {
  const items: CampaignDashboardAttentionItem[] = [];
  const href = `/campaigns/${campaign.id}`;

  if (campaign.publishError) {
    items.push({
      id: `${campaign.id}:publish-error`,
      campaignId: campaign.id,
      campaignName: campaign.name,
      title: 'Publishing failed',
      detail: campaign.publishError,
      severity: 'critical',
      href,
    });
  }

  if (campaign.status === 'ACTIVE' && campaign.metaStatus && campaign.metaStatus !== 'ACTIVE') {
    items.push({
      id: `${campaign.id}:meta-status`,
      campaignId: campaign.id,
      campaignName: campaign.name,
      title: 'Meta delivery is not active',
      detail: `Meta status is ${campaign.metaStatus}. Check Ads Manager before spending more.`,
      severity: 'warning',
      href,
    });
  }

  if (campaign.status === 'ACTIVE' && isStaleSync(campaign.lastSyncedAt)) {
    items.push({
      id: `${campaign.id}:stale-sync`,
      campaignId: campaign.id,
      campaignName: campaign.name,
      title: 'Performance data is stale',
      detail: campaign.lastSyncedAt
        ? 'Last sync is more than 36 hours old.'
        : 'This campaign has never synced performance.',
      severity: 'warning',
      href,
    });
  }

  if (campaign.performance.spend >= 5 && campaign.performance.conversions === 0) {
    items.push({
      id: `${campaign.id}:no-bookings`,
      campaignId: campaign.id,
      campaignName: campaign.name,
      title: 'Spend with no bookings',
      detail: `Spent £${campaign.performance.spend.toFixed(2)} without a tracked booking.`,
      severity: 'warning',
      href,
    });
  }

  if (campaign.performance.impressions >= 500 && campaign.performance.ctr > 0 && campaign.performance.ctr < 0.5) {
    items.push({
      id: `${campaign.id}:weak-ctr`,
      campaignId: campaign.id,
      campaignName: campaign.name,
      title: 'Weak click-through rate',
      detail: `CTR is ${campaign.performance.ctr.toFixed(2)}%, so the creative or audience may need work.`,
      severity: 'info',
      href,
    });
  }

  if (campaign.performance.clicks >= 10 && campaign.performance.cpc >= 1) {
    items.push({
      id: `${campaign.id}:high-cpc`,
      campaignId: campaign.id,
      campaignName: campaign.name,
      title: 'High cost per click',
      detail: `CPC is £${campaign.performance.cpc.toFixed(2)} after ${campaign.performance.clicks} clicks.`,
      severity: 'info',
      href,
    });
  }

  return items;
}

function flattenCampaignAds(campaign: Campaign & { adSets?: AdSet[] }): CampaignDashboardAdSummary[] {
  return (campaign.adSets ?? []).flatMap((adSet) =>
    (adSet.ads ?? []).map((ad) => adToSummary(campaign, adSet, ad)),
  );
}

function adToSummary(campaign: Campaign, adSet: AdSet, ad: Ad): CampaignDashboardAdSummary {
  return {
    id: ad.id,
    campaignId: campaign.id,
    campaignName: campaign.name,
    adSetId: adSet.id,
    adSetName: adSet.name,
    name: ad.name,
    headline: ad.headline,
    status: ad.status,
    metaStatus: ad.metaStatus,
    performance: ad.performance,
    lastSyncedAt: ad.lastSyncedAt,
  };
}

function addPerformance(
  acc: CampaignPerformanceMetrics,
  performance: CampaignPerformanceMetrics,
): CampaignPerformanceMetrics {
  return {
    spend: acc.spend + performance.spend,
    impressions: acc.impressions + performance.impressions,
    reach: acc.reach + performance.reach,
    clicks: acc.clicks + performance.clicks,
    ctr: 0,
    cpc: 0,
    conversions: acc.conversions + performance.conversions,
    costPerConversion: 0,
    conversionRate: 0,
  };
}

function isStaleSync(value: Date | null): boolean {
  if (!value) return true;
  const ageMs = Date.now() - value.getTime();
  return ageMs > 36 * 60 * 60 * 1000;
}
