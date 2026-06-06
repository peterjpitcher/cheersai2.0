import {
  EMPTY_EVENT_BOOKING_INSIGHTS,
  type EventBookingInsights,
} from '@/lib/campaigns/event-booking-insights';
import {
  sortAdSetsByStartDate,
  sortAdsByPerformance,
} from '@/lib/campaigns/performance-matrix';
import type {
  Ad,
  AdSet,
  Campaign,
  CampaignStatus,
  CampaignPerformanceMetrics,
  OptimisationActionSummary,
} from '@/types/campaigns';

export type DashboardAttentionSeverity = 'critical' | 'warning' | 'info';
export type CampaignDashboardDeliveryKind = 'active' | 'attention' | 'paused' | 'draft' | 'finished';
export type CampaignDashboardDeliverySource = 'meta' | 'local' | 'schedule';

export interface CampaignDashboardDeliveryStatus {
  kind: CampaignDashboardDeliveryKind;
  source: CampaignDashboardDeliverySource;
  label: string;
  detail: string;
  active: boolean;
  finished: boolean;
  priority: number;
}

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
  deliveryStatus: CampaignDashboardDeliveryStatus;
}

export interface CampaignDashboardModel {
  totals: CampaignPerformanceMetrics & {
    campaigns: number;
    activeCampaigns: number;
    draftCampaigns: number;
    pausedCampaigns: number;
    attentionCampaigns: number;
    finishedCampaigns: number;
  };
  campaigns: CampaignDashboardCampaign[];
  attentionItems: CampaignDashboardAttentionItem[];
  bestAds: CampaignDashboardAdSummary[];
  optimisationActions: OptimisationActionSummary[];
  eventBookingInsights: EventBookingInsights;
}

const EMPTY_PERFORMANCE: CampaignPerformanceMetrics = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  ctr: 0,
  cpc: 0,
  conversions: 0,
  metaConversions: 0,
  firstPartyBookings: 0,
  blendedBookings: 0,
  costPerConversion: 0,
  conversionRate: 0,
};

export function buildCampaignDashboard(
  campaigns: Campaign[],
  optimisationActions: OptimisationActionSummary[] = [],
  eventBookingInsights: EventBookingInsights = EMPTY_EVENT_BOOKING_INSIGHTS,
  options: { now?: Date; firstPartyBookingCounts?: Map<string, number> } = {},
): CampaignDashboardModel {
  const now = options.now ?? new Date();
  const dashboardCampaigns = campaigns.map((campaign) => {
    const campaignWithFirstPartyBookings = applyFirstPartyBookingCount(
      campaign,
      options.firstPartyBookingCounts?.get(campaign.id) ?? 0,
    );
    const adSets = sortAdSetsByStartDate(campaign.adSets ?? []);
    const adSummaries = flattenCampaignAds({ ...campaignWithFirstPartyBookings, adSets });
    const sortedAds = sortAdsByPerformance(adSummaries);
    const deliveryStatus = getCampaignDeliveryStatus(campaignWithFirstPartyBookings, now);
    const attentionItems = buildCampaignAttentionItems(campaignWithFirstPartyBookings, deliveryStatus);

    return {
      ...campaignWithFirstPartyBookings,
      adSets,
      topAd: sortedAds[0] ?? null,
      attentionItems,
      deliveryStatus,
    };
  });

  const bestAds = sortAdsByPerformance(
    dashboardCampaigns.flatMap((campaign) => flattenCampaignAds(campaign)),
  ).slice(0, 8);
  const attentionItems = dashboardCampaigns.flatMap((campaign) => campaign.attentionItems);
  const openCampaignIds = new Set(
    dashboardCampaigns
      .filter((campaign) => !campaign.deliveryStatus.finished)
      .map((campaign) => campaign.id),
  );
  const openOptimisationActions = optimisationActions.filter((action) => openCampaignIds.has(action.campaignId));

  return {
    totals: buildDashboardTotals(dashboardCampaigns),
    campaigns: dashboardCampaigns,
    attentionItems,
    bestAds,
    optimisationActions: openOptimisationActions,
    eventBookingInsights,
  };
}

function applyFirstPartyBookingCount(campaign: Campaign, firstPartyBookings: number): Campaign {
  const metaConversions = campaign.performance.metaConversions ?? campaign.performance.conversions;
  const blendedBookings = Math.max(metaConversions, firstPartyBookings);

  return {
    ...campaign,
    performance: {
      ...campaign.performance,
      metaConversions,
      firstPartyBookings,
      blendedBookings,
      conversions: blendedBookings,
      costPerConversion: blendedBookings > 0 ? campaign.performance.spend / blendedBookings : 0,
      conversionRate: campaign.performance.clicks > 0
        ? (blendedBookings / campaign.performance.clicks) * 100
        : 0,
    },
  };
}

export function getCampaignDeliveryStatus(
  campaign: Pick<Campaign, 'status' | 'metaStatus' | 'endDate'>,
  now: Date = new Date(),
): CampaignDashboardDeliveryStatus {
  const metaStatus = normaliseMetaStatus(campaign.metaStatus);
  const metaLabel = metaStatus ? formatStatusLabel(metaStatus) : null;
  const localLabel = formatStatusLabel(campaign.status);

  if (campaignHasFinished(campaign, now)) {
    return {
      kind: 'finished',
      source: 'schedule',
      label: 'Finished',
      detail: metaLabel ? `Ended ${campaign.endDate} | Meta: ${metaLabel}` : `Ended ${campaign.endDate}`,
      active: false,
      finished: true,
      priority: 4,
    };
  }

  if (metaStatus) {
    if (metaStatus === 'ACTIVE') {
      return {
        kind: 'active',
        source: 'meta',
        label: 'Active',
        detail: `Meta: ${metaLabel}`,
        active: true,
        finished: false,
        priority: 0,
      };
    }

    if (META_FINISHED_STATUSES.has(metaStatus)) {
      return {
        kind: 'finished',
        source: 'meta',
        label: 'Finished',
        detail: `Meta: ${metaLabel}`,
        active: false,
        finished: true,
        priority: 4,
      };
    }

    if (META_PAUSED_STATUSES.has(metaStatus)) {
      return {
        kind: 'paused',
        source: 'meta',
        label: 'Paused',
        detail: `Meta: ${metaLabel}`,
        active: false,
        finished: false,
        priority: 2,
      };
    }

    return {
      kind: 'attention',
      source: 'meta',
      label: 'Needs attention',
      detail: `Meta: ${metaLabel}`,
      active: false,
      finished: false,
      priority: 1,
    };
  }

  if (campaign.status === 'ACTIVE') {
    return {
      kind: 'active',
      source: 'local',
      label: 'Active',
      detail: 'Meta: not synced',
      active: true,
      finished: false,
      priority: 0,
    };
  }

  if (campaign.status === 'PAUSED') {
    return {
      kind: 'paused',
      source: 'local',
      label: 'Paused',
      detail: 'Meta: not synced',
      active: false,
      finished: false,
      priority: 2,
    };
  }

  if (campaign.status === 'ARCHIVED') {
    return {
      kind: 'finished',
      source: 'local',
      label: 'Finished',
      detail: `App: ${localLabel}`,
      active: false,
      finished: true,
      priority: 4,
    };
  }

  return {
    kind: 'draft',
    source: 'local',
    label: 'Draft',
    detail: 'Not published to Meta',
    active: false,
    finished: false,
    priority: 3,
  };
}

function buildDashboardTotals(campaigns: CampaignDashboardCampaign[]): CampaignDashboardModel['totals'] {
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
    activeCampaigns: campaigns.filter((campaign) => campaign.deliveryStatus.kind === 'active').length,
    draftCampaigns: campaigns.filter((campaign) => campaign.deliveryStatus.kind === 'draft').length,
    pausedCampaigns: campaigns.filter((campaign) => campaign.deliveryStatus.kind === 'paused').length,
    attentionCampaigns: campaigns.filter((campaign) => campaign.deliveryStatus.kind === 'attention').length,
    finishedCampaigns: campaigns.filter((campaign) => campaign.deliveryStatus.kind === 'finished').length,
  };
}

function buildCampaignAttentionItems(
  campaign: Campaign,
  deliveryStatus: CampaignDashboardDeliveryStatus,
): CampaignDashboardAttentionItem[] {
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

  if (!deliveryStatus.finished && campaign.status === 'ACTIVE' && campaign.metaStatus && deliveryStatus.kind !== 'active') {
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

  if (deliveryStatus.active && isStaleSync(campaign.lastSyncedAt)) {
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

  if (!deliveryStatus.finished && campaign.performance.spend >= 5 && (campaign.performance.blendedBookings ?? campaign.performance.conversions) === 0) {
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

  if (!deliveryStatus.finished && campaign.performance.impressions >= 500 && campaign.performance.ctr > 0 && campaign.performance.ctr < 0.5) {
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

  if (!deliveryStatus.finished && campaign.performance.clicks >= 10 && campaign.performance.cpc >= 1) {
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
    metaConversions: (acc.metaConversions ?? acc.conversions) + (performance.metaConversions ?? performance.conversions),
    firstPartyBookings: (acc.firstPartyBookings ?? 0) + (performance.firstPartyBookings ?? 0),
    blendedBookings: (acc.blendedBookings ?? acc.conversions) + (performance.blendedBookings ?? performance.conversions),
    costPerConversion: 0,
    conversionRate: 0,
  };
}

function isStaleSync(value: Date | null): boolean {
  if (!value) return true;
  const ageMs = Date.now() - value.getTime();
  return ageMs > 36 * 60 * 60 * 1000;
}

const META_PAUSED_STATUSES = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']);
const META_FINISHED_STATUSES = new Set(['ARCHIVED', 'DELETED']);

function normaliseMetaStatus(value: string | null): string | null {
  if (!value) return null;
  const normalised = value.trim().toUpperCase().replace(/\s+/g, '_');
  return normalised.length > 0 ? normalised : null;
}

function campaignHasFinished(
  campaign: Pick<Campaign, 'status' | 'metaStatus' | 'endDate'>,
  now: Date,
): boolean {
  if (!campaign.endDate) return false;
  if (campaign.status === 'DRAFT') return false;

  const today = dateOnly(now);
  return campaign.endDate < today;
}

function dateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatStatusLabel(value: string | CampaignStatus): string {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
