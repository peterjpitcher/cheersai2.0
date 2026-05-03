export type CampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES';

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type AdSetStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';
export type AdStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';
export type BudgetType = 'DAILY' | 'LIFETIME';
export type SpecialAdCategory = 'NONE' | 'HOUSING' | 'EMPLOYMENT' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS';
export type CtaType = 'LEARN_MORE' | 'SIGN_UP' | 'GET_QUOTE' | 'BOOK_NOW' | 'CONTACT_US' | 'SUBSCRIBE';
export type PaidCampaignKind = 'event' | 'evergreen';
export type GeoRadiusMiles = 1 | 3 | 5 | 10;
export type AudienceMode = 'local_only' | 'local_interests';

export interface ResolvedMetaInterest {
  id: string;
  name: string;
  path?: string[];
  description?: string | null;
  audienceSize?: number | null;
  audienceSizeLowerBound?: number | null;
  audienceSizeUpperBound?: number | null;
}

export interface CampaignPerformanceMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  costPerConversion: number;
  conversionRate: number;
}

export interface MetaAdAccount {
  id: string;
  accountId: string;
  metaAccountId: string;
  currency: string;
  timezone: string;
  tokenExpiresAt: Date | null;
  setupComplete: boolean;
  metaPixelId: string | null;
  conversionEventName: string;
  conversionOptimisationEnabled: boolean;
  createdAt: Date;
}

export type OptimisationMode = 'apply' | 'dry_run';
export type OptimisationRunStatus = 'running' | 'completed' | 'failed';
export type OptimisationActionType = 'pause_ad';
export type OptimisationActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';

export interface OptimisationActionSummary {
  id: string;
  runId: string;
  campaignId: string;
  campaignName: string | null;
  adSetId: string | null;
  adSetName: string | null;
  adId: string | null;
  adName: string | null;
  actionType: OptimisationActionType;
  reason: string;
  status: OptimisationActionStatus;
  error: string | null;
  metricsSnapshot: Record<string, unknown>;
  appliedAt: Date | null;
  createdAt: Date;
}

export interface EventBookingInsightItem {
  key: string;
  name: string;
  bookings: number;
  tickets: number;
  value: number;
}

export interface EventBookingInsights {
  totalBookings30d: number;
  totalBookings90d: number;
  totalTickets90d: number;
  totalValue90d: number;
  topCategories90d: EventBookingInsightItem[];
  topEvents90d: EventBookingInsightItem[];
  topCampaigns90d: EventBookingInsightItem[];
}

export interface AdTargeting {
  age_min: number;
  age_max: number;
  genders?: number[];
  geo_locations: {
    cities?: Array<{
      key: string;
      name?: string;
      region?: string;
      country?: string;
      radius?: number;
      distance_unit?: 'mile' | 'kilometer';
    }>;
    custom_locations?: Array<{
      latitude: number;
      longitude: number;
      radius: number;
      distance_unit: 'mile' | 'kilometer';
      country?: string;
    }>;
    regions?: Array<{ key: string; name?: string; country?: string }>;
    countries?: string[];
    location_types?: Array<'home' | 'recent'>;
  };
  interests?: Array<{ id: string; name: string }>;
  flexible_spec?: Array<{
    interests?: Array<{ id: string; name?: string }>;
  }>;
}

export interface Ad {
  id: string;
  adsetId: string;
  metaAdId: string | null;
  metaCreativeId: string | null;
  name: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: CtaType;
  angle: string | null;
  mediaAssetId: string | null;
  creativeBrief: string | null;
  previewUrl: string | null;
  metaStatus: string | null;
  performance: CampaignPerformanceMetrics;
  lastSyncedAt: Date | null;
  status: AdStatus;
  createdAt: Date;
}

export interface AdSet {
  id: string;
  campaignId: string;
  metaAdsetId: string | null;
  name: string;
  phaseLabel: string | null;
  phaseStart: string | null;
  phaseEnd: string | null;
  targeting: AdTargeting;
  placements: 'AUTO' | object;
  budgetAmount: number | null;
  optimisationGoal: string;
  bidStrategy: string;
  adsetMediaAssetId: string | null;
  adsetImageUrl: string | null;
  adsStopTime: string | null;
  metaStatus: string | null;
  performance: CampaignPerformanceMetrics;
  lastSyncedAt: Date | null;
  status: AdSetStatus;
  createdAt: Date;
  ads?: Ad[];
}

export interface Campaign {
  id: string;
  accountId: string;
  metaCampaignId: string | null;
  name: string;
  objective: CampaignObjective;
  problemBrief: string;
  aiRationale: string | null;
  budgetType: BudgetType;
  budgetAmount: number;
  startDate: string;
  endDate: string | null;
  status: CampaignStatus;
  metaStatus: string | null;
  publishError: string | null;
  specialAdCategory: SpecialAdCategory;
  campaignKind: PaidCampaignKind;
  sourceType: string | null;
  sourceId: string | null;
  destinationUrl: string | null;
  geoRadiusMiles: GeoRadiusMiles;
  audienceMode: AudienceMode;
  audienceInterestKeywords: string[];
  resolvedInterests: ResolvedMetaInterest[];
  sourceSnapshot: Record<string, unknown> | null;
  performance: CampaignPerformanceMetrics;
  lastSyncedAt: Date | null;
  createdAt: Date;
  adSets?: AdSet[];
}

// AI generation output shape
export interface AiCampaignPayload {
  objective: CampaignObjective;
  rationale: string;
  campaign_name: string;
  special_ad_category: SpecialAdCategory;
  audience_keywords?: string[];
  ad_sets: Array<{
    name: string;
    phase_label: string;      // e.g. "Early Awareness"
    phase_start: string;      // ISO date e.g. "2026-03-01"
    phase_end: string | null; // ISO date or null for last phase
    audience_description: string;
    targeting: AdTargeting;
    placements: 'AUTO';
    optimisation_goal: string;
    bid_strategy: string;
    adset_media_asset_id?: string;
    adset_image_url?: string;
    ads_stop_time?: string;
    ads: Array<{
      name: string;
      headline: string;
      primary_text: string;
      description: string;
      cta: CtaType;
      creative_brief: string;
      angle: string;
      image_url?: string;       // previewUrl from MediaAssetSummary
      media_asset_id?: string;  // id from MediaAssetSummary
    }>;
  }>;
}
