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

export interface CampaignPerformanceMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
}

export interface MetaAdAccount {
  id: string;
  accountId: string;
  metaAccountId: string;
  currency: string;
  timezone: string;
  tokenExpiresAt: Date | null;
  setupComplete: boolean;
  createdAt: Date;
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
    regions?: Array<{ key: string; name?: string; country?: string }>;
    countries?: string[];
    location_types?: Array<'home' | 'recent'>;
  };
  interests?: Array<{ id: string; name: string }>;
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
