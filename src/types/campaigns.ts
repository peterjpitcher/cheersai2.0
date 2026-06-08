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
export type PaidCampaignKind = 'event' | 'evergreen' | 'food_booking';

export type FoodServiceKey = 'weekday_dinner' | 'saturday_food' | 'sunday_roast';

export type FoodDecisionStage =
  | 'planning' | 'lunch_decision' | 'afternoon_commit'
  | 'tomorrow' | 'morning_commit' | 'last_tables' | 'last_minute';

export type RunDay =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface FoodServiceHours {
  serviceKey: FoodServiceKey;
  enabled: boolean;
  days: RunDay[];
  startLocal: string;        // 'HH:MM'
  endLocal: string;          // 'HH:MM'
  lastOrdersLocal?: string;  // defaults to endLocal − 30min
}

export interface FoodAdWindow {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
  runDay: RunDay;
  runDate: string;                // 'YYYY-MM-DD' London-local
  startsAtLocal: string;          // 'HH:MM'
  endsAtLocal: string;            // 'HH:MM'
  serviceDate: string;            // 'YYYY-MM-DD'
  serviceDateOffsetDays: number;  // serviceDate − runDate, in days
  budgetWeight: number;
  copyIntent: string;
  windowKey: string;              // stable utm_content key, e.g. 'sun_roast_morning'
  enabled: boolean;
}

export interface FoodBookingBrief {
  services: FoodServiceHours[];
  bookingUrl: string;
  foodHooks: string[];
  weeks: 1 | 2 | 4;
  dayWeighting: 'even' | 'boost_quiet' | 'manual';
  manualDayWeights?: Partial<Record<RunDay, number>>;
}
export type CampaignPhaseType = 'run-up' | 'day-before' | 'day-of' | 'evergreen' | 'booking-push' | 'closeout';
export type PaidExecutionMode = 'single_push' | 'two_phase' | 'three_phase';
export type GeoRadiusMiles = 1 | 3 | 5 | 10;
export type AudienceMode = 'local_only' | 'local_interests';
export type CreativeFormat =
  | 'venue_photo'
  | 'people_social'
  | 'offer_graphic'
  | 'event_detail'
  | 'short_video';
export type CampaignQualityStatus = 'ready' | 'needs_attention' | 'blocked';

export interface PaidMediaPlanPhase {
  phaseType: CampaignPhaseType;
  phaseLabel: string;
  phaseStart: string;
  phaseEnd: string | null;
  adsStopTime: string | null;
}

export interface PaidMediaPlanBudgetRecommendation {
  currentBudgetAmount: number;
  recommendedBudgetAmount: number;
  additionalBudgetAmount: number;
  budgetType: BudgetType;
  currentExecutionMode: PaidExecutionMode;
  targetExecutionMode: PaidExecutionMode;
  reason: string;
}

export interface PaidMediaPlan {
  campaignKind: 'event';
  strategicPhases: PaidMediaPlanPhase[];
  executionPhases: PaidMediaPlanPhase[];
  executionMode: PaidExecutionMode;
  budgetRecommendation: PaidMediaPlanBudgetRecommendation | null;
  minBudgetPerExecutionPhase: number;
  lifetimeEquivalentBudget: number;
  durationDays: number;
  rationale: string;
}

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
  metaConversions?: number;
  firstPartyBookings?: number;
  firstPartyBookingValue?: number;
  blendedBookings?: number;
  blendedBookingValue?: number;
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

export type OptimisationMode = 'apply' | 'dry_run' | 'recommend';
export type OptimisationRunStatus = 'running' | 'completed' | 'failed';
export type OptimisationActionType = 'pause_ad' | 'tracking_issue' | 'copy_rewrite';
export type OptimisationActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';
export type OptimisationSeverity = 'info' | 'warning' | 'critical';

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
  severity: OptimisationSeverity;
  error: string | null;
  metricsSnapshot: Record<string, unknown>;
  recommendationPayload: Record<string, unknown>;
  replacementAdId: string | null;
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
  creativeFormat: CreativeFormat | null;
  creativeVariantKey: string | null;
  utmContentKey: string | null;
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
  adsStartTime?: string | null;
  serviceKey?: FoodServiceKey | null;
  decisionStage?: FoodDecisionStage | null;
  budgetWeight?: number | null;
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
  qualityScore: number | null;
  qualityStatus: CampaignQualityStatus | null;
  qualityIssues: Record<string, unknown>[];
  audienceStrategy: Record<string, unknown> | null;
  performance: CampaignPerformanceMetrics;
  lastSyncedAt: Date | null;
  campaignType: string | null;
  autoConfirm: boolean;
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
  media_plan?: PaidMediaPlan;
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
      creative_format?: CreativeFormat | string;
      creative_variant_key?: string;
      utm_content_key?: string;
      image_url?: string;       // previewUrl from MediaAssetSummary
      media_asset_id?: string;  // id from MediaAssetSummary
    }>;
  }>;
}
