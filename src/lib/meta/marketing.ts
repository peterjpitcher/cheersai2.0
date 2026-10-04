import { getMetaGraphApiBase } from '@/lib/meta/graph';

// ─── Error class ─────────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly subcode?: number,
    public readonly userTitle?: string,
    public readonly userMessage?: string,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CreateCampaignParams {
  accessToken: string;
  adAccountId: string;
  name: string;
  objective: string;
  specialAdCategory: string;
  status: 'ACTIVE' | 'PAUSED';
  // Campaign Budget Optimization (CBO): when `useCampaignBudgetOptimization` is true the
  // budget is set on the campaign and Meta shares it across ad sets. Used by food_booking,
  // which schedules many short overlapping ad-set windows that must compete for one budget.
  useCampaignBudgetOptimization?: boolean;
  dailyBudget?: number;
  lifetimeBudget?: number;
  // Campaign-level flight end (UTC ISO). Required by Meta when a campaign-level lifetime
  // budget is set; ignored for daily budgets. Used by food_booking under lifetime CBO.
  endTime?: string;
}

export interface CreateAdSetParams {
  accessToken: string;
  adAccountId: string;
  campaignId: string;
  name: string;
  targeting: Record<string, unknown>;
  optimisationGoal: string;
  bidStrategy: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  startTime: string;
  endTime?: string;
  status: 'ACTIVE' | 'PAUSED';
  promotedObject?: Record<string, unknown>;
  // Hybrid CBO per-ad-set spend caps (Phase 3 / P3-3). Under campaign budget optimization
  // the budget lives on the campaign, but Meta lets each ad set declare a floor/ceiling on
  // its share. These are only valid — and only emitted — when the PARENT campaign has CBO
  // enabled; set `parentUsesCampaignBudgetOptimization` so we never send caps to a non-CBO
  // ad set (Meta would reject them). Caps are in major units (pounds) and converted to
  // minor units (pence) on send. When either bound is absent, no cap is emitted.
  parentUsesCampaignBudgetOptimization?: boolean;
  minBudget?: number;
  maxBudget?: number;
  // Delivery schedule ("day parting"): the ad set only delivers inside these windows. Meta
  // only accepts it on an ad set that owns a lifetime budget (so it also has an end_time)
  // and is not under campaign budget optimisation, where pacing belongs to the campaign.
  // createMetaAdSet refuses anything else before sending. Absent means no schedule, and the
  // request is exactly what it was before this field existed.
  schedule?: MetaAdSetScheduleEntry[];
}

/**
 * One Meta ad set delivery window (an `adset_schedule` entry). Minutes count from midnight
 * in the time zone named by `timezone_type` (USER or ADVERTISER); `days` run 0 (Sunday) to
 * 6 (Saturday). Meta only takes whole hours, so minutes are multiples of 60.
 */
export interface MetaAdSetScheduleEntry {
  start_minute: number;
  end_minute: number;
  days: number[];
  timezone_type: string;
}

/** What Meta reports for an ad set's delivery schedule, read back after creation. */
export interface MetaAdSetScheduleReadBack {
  pacingType: string[];
  adsetSchedule: MetaAdSetScheduleEntry[];
}

export interface CreateAdCreativeParams {
  accessToken: string;
  adAccountId: string;
  name: string;
  pageId: string;
  linkUrl: string;
  imageHash: string;
  message: string;
  headline?: string;
  description?: string;
  callToActionType?: string;
  // When true, the creative is sent with every recorded Meta automatic creative change set to
  // OPT_OUT (RECORDED_CREATIVE_FEATURES), so Meta cannot rewrite the copy or edit the image.
  // Absent or false sends exactly the request that was sent before this field existed.
  optOutCreativeEnhancements?: boolean;
}

/**
 * Every key Meta returned in `creative.degrees_of_freedom_spec.creative_features_spec` for the
 * 13 existing weekday food ads (the 12 originals and Lunch A's paused rewrite), read with GET
 * requests only on 4 October 2026 against Graph API v24.0. Both groups returned the same 83
 * keys. On the 12 originals every key was OPT_OUT except `video_filtering` (OPT_IN); on the
 * rewrite all 83 were OPT_OUT.
 *
 * The list is recorded rather than assumed: the `standard_enhancements` bundle is not among the
 * keys Meta returns and is not relied on to cover them. Read the keys again before using this
 * list on another Graph version (tasks/SPEC-weekday-food-optimisation.md, C1).
 */
export const RECORDED_CREATIVE_FEATURES = [
  'adapt_to_placement', 'add_text_overlay', 'ads_with_benefits', 'advantage_plus_creative',
  'app_highlights', 'audio', 'auto_promotion_tag', 'biz_ai', 'carousel_to_video',
  'catalog_feed_tag', 'creative_stickers', 'customize_product_recommendation', 'cv_transformation',
  'description_automation', 'dha_optimization', 'dynamic_cta_text', 'dynamic_partner_content',
  'enable_ncs_testimonials', 'enhance_cta', 'fb_feed_tag', 'fb_reels_tag', 'fb_story_tag',
  'feed_caption_optimization', 'generate_cta', 'hide_price', 'hyperlink_formatting', 'ig_feed_tag',
  'ig_glados_feed', 'ig_reels_tag', 'ig_stream_tag', 'ig_video_native_subtitle', 'image_animation',
  'image_auto_crop', 'image_background_gen', 'image_banner', 'image_brightness_and_contrast',
  'image_end_card', 'image_enhancement', 'image_templates', 'image_text_translation',
  'image_touchups', 'image_uncrop', 'inline_comment', 'local_store_extension',
  'media_liquidity_animated_image', 'media_order', 'media_type_automation',
  'multi_creative_post_carousel', 'multi_photo_to_video', 'music_generation',
  'pac_genai_recomposition', 'pac_recomposition', 'pac_relaxation', 'product_browsing',
  'product_extensions', 'product_metadata_automation', 'product_tags', 'profile_card',
  'profile_extension', 'replace_media_text', 'reveal_details_over_time', 'show_destination_blurbs',
  'show_summary', 'site_extensions', 'standard_enhancements_catalog',
  'text_extraction_for_headline', 'text_extraction_for_tap_target', 'text_formatting_optimization',
  'text_generation', 'text_optimizations', 'text_overlay_translation', 'text_translation',
  'translate_voiceover', 'video_auto_crop', 'video_filtering', 'video_highlight',
  'video_highlights', 'video_to_image', 'video_uncrop', 'video_uncrop_9x16_to_9x18',
  'video_voiceover', 'wa_mm_image_filtering', 'wa_mm_text_truncation_length',
] as const;

/** What Meta holds for one ad and its creative, read back before the ad is switched on. */
export interface MetaAdLaunchReadBack {
  adId: string;
  name: string | null;
  adSetId: string | null;
  configuredStatus: string | null;
  effectiveStatus: string | null;
  /** Meta's review feedback, or null when Meta returned none (an empty object counts as none). */
  reviewFeedback: Record<string, unknown> | null;
  creative: MetaCreativeLaunchReadBack;
}

export interface MetaCreativeLaunchReadBack {
  id: string | null;
  name: string | null;
  pageId: string | null;
  /** `object_story_spec.link_data.link`. */
  link: string | null;
  /** `object_story_spec.link_data.message` (the primary text). */
  message: string | null;
  /** `object_story_spec.link_data.name` (the headline). */
  headline: string | null;
  description: string | null;
  callToActionType: string | null;
  /** `object_story_spec.link_data.call_to_action.value.link`. */
  callToActionLink: string | null;
  /** `degrees_of_freedom_spec.creative_features_spec` exactly as Meta returned it, or null. */
  creativeFeaturesSpec: Record<string, unknown> | null;
}

export type CreativeEnhancementsCheckResult = 'pass' | 'fail' | 'unverified';
export type AdReviewCheckResult = 'pass' | 'fail' | 'pending';

export interface MetaLaunchCheck<Result extends string> {
  result: Result;
  /** Plain-English reasons for anything other than a pass; empty on a pass. */
  reasons: string[];
}

export interface CreateAdParams {
  accessToken: string;
  adAccountId: string;
  name: string;
  adsetId: string;
  creativeId: string;
  status: 'ACTIVE' | 'PAUSED';
}

export interface CampaignInsights {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  reactions: number;
  comments: number;
  shares: number;
  costPerConversion: number;
  conversionRate: number;
  status: string;
}

export interface MetaInsightsOptions {
  since?: string;
  until?: string;
}

export interface MetaGeoLocation {
  key: string;
  name?: string;
  type?: string;
  country_code?: string;
  country_name?: string;
  region?: string;
  supports_city?: boolean;
  supports_region?: boolean;
}

export interface MetaInterest {
  id: string;
  name: string;
  path?: string[];
  description?: string | null;
  audience_size?: number | null;
  audience_size_lower_bound?: number | null;
  audience_size_upper_bound?: number | null;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

interface MetaErrorPayload {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
  };
}

function extractMetaError(payload: unknown): {
  message: string;
  code: number;
  subcode?: number;
  userTitle?: string;
  userMessage?: string;
} {
  const p = payload as MetaErrorPayload;
  if (p?.error) {
    return {
      message: p.error.message ?? 'Meta API error',
      code: p.error.code ?? 0,
      subcode: p.error.error_subcode,
      userTitle: p.error.error_user_title,
      userMessage: p.error.error_user_msg,
    };
  }
  return { message: 'Meta API error', code: 0 };
}

async function metaPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const base = getMetaGraphApiBase();
  const url = `${base}${path}`;

  const formBody = new URLSearchParams();
  formBody.set('access_token', accessToken);
  for (const [key, value] of Object.entries(body)) {
    formBody.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody.toString(),
  });

  const json = await res.json() as MetaErrorPayload;

  if (!res.ok || json?.error) {
    const { message, code, subcode, userTitle, userMessage } = extractMetaError(json);
    throw new MetaApiError(message, code, subcode, userTitle, userMessage);
  }

  return json as T;
}

async function metaGet<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<T> {
  const base = getMetaGraphApiBase();
  const searchParams = new URLSearchParams({ access_token: accessToken, ...params });
  const url = `${base}${path}?${searchParams.toString()}`;

  const res = await fetch(url, { method: 'GET' });
  const json = await res.json() as MetaErrorPayload;

  if (!res.ok || json?.error) {
    const { message, code, subcode, userTitle, userMessage } = extractMetaError(json);
    throw new MetaApiError(message, code, subcode, userTitle, userMessage);
  }

  return json as T;
}

// ─── Public functions ─────────────────────────────────────────────────────────

export async function createMetaCampaign(
  params: CreateCampaignParams,
): Promise<{ id: string }> {
  const {
    accessToken,
    adAccountId,
    name,
    objective,
    specialAdCategory,
    status,
    useCampaignBudgetOptimization,
    dailyBudget,
    lifetimeBudget,
    endTime,
  } = params;

  const specialAdCategories = specialAdCategory === 'NONE' ? [] : [specialAdCategory];
  const body: Record<string, unknown> = {
    name,
    objective,
    status,
    special_ad_categories: specialAdCategories,
    is_adset_budget_sharing_enabled: false,
  };

  // CBO: only when explicitly requested do we move the budget onto the campaign and let
  // Meta share it across ad sets. Without the flag, behaviour is unchanged (no campaign
  // budget; ad sets carry their own). Budgets are minor units (pence).
  if (useCampaignBudgetOptimization) {
    body.is_adset_budget_sharing_enabled = true;
    if (lifetimeBudget !== undefined) {
      // Meta requires a campaign end_time whenever a lifetime budget is set; fail fast
      // (mirroring createMetaAdSet) rather than sending a request Meta will reject.
      if (!endTime) {
        throw new MetaApiError(
          'Lifetime budget campaigns require an end date. Set an end date on the campaign before publishing.',
          100,
        );
      }
      body.lifetime_budget = Math.round(lifetimeBudget * 100);
      body.end_time = endTime;
    } else if (dailyBudget !== undefined) {
      body.daily_budget = Math.round(dailyBudget * 100);
    }
  }

  return metaPost<{ id: string }>(
    `/${adAccountId}/campaigns`,
    accessToken,
    body,
  );
}

export async function searchMetaGeoLocations(
  accessToken: string,
  query: string,
  options?: { countryCode?: string; limit?: number },
): Promise<MetaGeoLocation[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const response = await metaGet<{ data?: MetaGeoLocation[] }>('/search', accessToken, {
    type: 'adgeolocation',
    location_types: JSON.stringify(['city', 'region']),
    country_code: options?.countryCode ?? 'GB',
    q: trimmedQuery,
    limit: String(options?.limit ?? 10),
  });

  return Array.isArray(response.data) ? response.data : [];
}

export async function searchMetaInterests(
  accessToken: string,
  query: string,
  options?: { limit?: number },
): Promise<MetaInterest[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const response = await metaGet<{ data?: Array<Record<string, unknown>> }>('/search', accessToken, {
    type: 'adinterest',
    q: trimmedQuery,
    limit: String(options?.limit ?? 10),
  });

  if (!Array.isArray(response.data)) return [];

  return response.data
    .map((interest): MetaInterest | null => {
      const id = typeof interest.id === 'string' || typeof interest.id === 'number'
        ? String(interest.id).trim()
        : '';
      const name = typeof interest.name === 'string' ? interest.name.trim() : '';
      if (!id || !name) return null;
      const path = Array.isArray(interest.path)
        ? interest.path.filter((item): item is string => typeof item === 'string')
        : undefined;

      return {
        id,
        name,
        path,
        description: typeof interest.description === 'string' ? interest.description : null,
        audience_size: normaliseMetaNumber(interest.audience_size),
        audience_size_lower_bound: normaliseMetaNumber(interest.audience_size_lower_bound),
        audience_size_upper_bound: normaliseMetaNumber(interest.audience_size_upper_bound),
      };
    })
    .filter((interest): interest is MetaInterest => interest !== null);
}

function normaliseMetaNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normaliseMetaCallToActionType(value: string): string {
  // Ads Manager's editable UI/export flow still represents "Book Now" as BOOK_TRAVEL.
  // Sending BOOK_NOW is accepted by the API, but Ads Manager renders it as "Unknown (BOOK_NOW)".
  if (value === 'BOOK_NOW') return 'BOOK_TRAVEL';
  return value;
}

export async function createMetaAdSet(
  params: CreateAdSetParams,
): Promise<{ id: string }> {
  const {
    accessToken,
    adAccountId,
    campaignId,
    name,
    targeting,
    optimisationGoal,
    bidStrategy,
    dailyBudget,
    lifetimeBudget,
    startTime,
    endTime,
    status,
    promotedObject,
    parentUsesCampaignBudgetOptimization,
    minBudget,
    maxBudget,
    schedule,
  } = params;

  if (schedule !== undefined) {
    assertAdSetScheduleAllowed({
      schedule,
      dailyBudget,
      lifetimeBudget,
      parentUsesCampaignBudgetOptimization,
    });
  }

  const body: Record<string, unknown> = {
    name,
    campaign_id: campaignId,
    targeting,
    optimization_goal: optimisationGoal,
    billing_event: 'IMPRESSIONS', // Fix D1: required by Meta API v24.0
    bid_strategy: bidStrategy,
    start_time: startTime,
    status,
  };

  if (dailyBudget !== undefined) {
    body.daily_budget = Math.round(dailyBudget * 100);
  }
  if (lifetimeBudget !== undefined) {
    // Meta requires end_time when lifetime_budget is set.
    if (!endTime) {
      throw new MetaApiError(
        'Lifetime budget ad sets require an end date. Set an end date on the campaign or ad set.',
        100,
      );
    }
    body.lifetime_budget = Math.round(lifetimeBudget * 100);
  }
  if (endTime !== undefined) {
    body.end_time = endTime;
  }
  if (promotedObject !== undefined) {
    body.promoted_object = promotedObject;
  }

  // Hybrid CBO spend caps: only valid when the parent campaign owns the budget (CBO). For
  // non-CBO ad sets Meta rejects min_budget/max_budget, so we ignore any caps passed in that
  // case. Each bound is sent independently in minor units (pence).
  if (parentUsesCampaignBudgetOptimization) {
    if (minBudget !== undefined) {
      body.min_budget = Math.round(minBudget * 100);
    }
    if (maxBudget !== undefined) {
      body.max_budget = Math.round(maxBudget * 100);
    }
  }

  // Appended last so a request without a schedule keeps its exact field order and content.
  if (schedule !== undefined) {
    body.pacing_type = ['day_parting'];
    body.adset_schedule = schedule;
  }

  return metaPost<{ id: string }>(`/${adAccountId}/adsets`, accessToken, body);
}

/**
 * Meta only runs an ad set schedule on a lifetime budget owned by the ad set. Refuse the
 * combinations it would reject, or silently ignore, before anything is sent.
 */
function assertAdSetScheduleAllowed(args: {
  schedule: MetaAdSetScheduleEntry[];
  dailyBudget?: number;
  lifetimeBudget?: number;
  parentUsesCampaignBudgetOptimization?: boolean;
}): void {
  if (args.schedule.length === 0) {
    throw new MetaApiError('A delivery schedule needs at least one delivery window.', 100);
  }
  if (args.parentUsesCampaignBudgetOptimization) {
    throw new MetaApiError(
      'A delivery schedule cannot go on an ad set under campaign budget optimisation; Meta takes it on the campaign.',
      100,
    );
  }
  if (args.dailyBudget !== undefined) {
    throw new MetaApiError(
      'A delivery schedule needs a lifetime budget. Meta does not allow chosen days and hours on a daily budget.',
      100,
    );
  }
  if (args.lifetimeBudget === undefined) {
    throw new MetaApiError('A delivery schedule needs a lifetime budget on the ad set.', 100);
  }
}

function toNumberOrNaN(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return Number.NaN;
}

function normaliseAdSetScheduleEntry(value: unknown): MetaAdSetScheduleEntry {
  const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    start_minute: toNumberOrNaN(entry.start_minute),
    end_minute: toNumberOrNaN(entry.end_minute),
    days: Array.isArray(entry.days) ? entry.days.map(toNumberOrNaN) : [],
    // A missing time zone type stays empty so it can never match what was sent.
    timezone_type: typeof entry.timezone_type === 'string' ? entry.timezone_type.toUpperCase() : '',
  };
}

/**
 * Read back an ad set's pacing and delivery schedule, so publish can confirm Meta stored the
 * schedule it was sent before anything is switched on. Missing or malformed values come back
 * empty or NaN, which never match a real schedule.
 */
export async function fetchMetaAdSetSchedule(
  adSetId: string,
  accessToken: string,
): Promise<MetaAdSetScheduleReadBack> {
  const response = await metaGet<{ pacing_type?: unknown; adset_schedule?: unknown }>(
    `/${adSetId}`,
    accessToken,
    { fields: 'pacing_type,adset_schedule' },
  );

  return {
    pacingType: Array.isArray(response.pacing_type)
      ? response.pacing_type.filter((value): value is string => typeof value === 'string')
      : [],
    adsetSchedule: Array.isArray(response.adset_schedule)
      ? response.adset_schedule.map(normaliseAdSetScheduleEntry)
      : [],
  };
}

export async function uploadMetaImage(
  adAccountId: string,
  accessToken: string,
  imageUrl: string,
): Promise<{ hash: string }> {
  // Fetch the image and convert to base64
  const imageRes = await fetch(imageUrl);
  const arrayBuffer = await imageRes.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  const result = await metaPost<{ images: Record<string, { hash: string }> }>(
    `/${adAccountId}/adimages`,
    accessToken,
    { bytes: base64 },
  );

  const keys = Object.keys(result.images);
  if (keys.length === 0) {
    throw new MetaApiError('No image returned from adimages endpoint', 0);
  }

  return { hash: result.images[keys[0]].hash };
}

export async function createMetaAdCreative(
  params: CreateAdCreativeParams,
): Promise<{ id: string }> {
  const {
    accessToken,
    adAccountId,
    name,
    pageId,
    linkUrl,
    imageHash,
    message,
    headline,
    description,
    callToActionType,
    optOutCreativeEnhancements,
  } = params;

  // message lives inside link_data per Meta v24.0/v25.0 object_story_spec spec.
  const linkData: Record<string, unknown> = {
    link: linkUrl,
    message,
    image_hash: imageHash,
  };

  if (headline) linkData.name = headline;
  if (description) linkData.description = description;
  if (callToActionType) {
    // call_to_action requires both type and value.link per Meta API spec.
    linkData.call_to_action = {
      type: normaliseMetaCallToActionType(callToActionType),
      value: { link: linkUrl },
    };
  }

  const body: Record<string, unknown> = {
    name,
    object_story_spec: {
      page_id: pageId,
      link_data: linkData,
    },
  };

  // Appended last, and only on request, so a creative made without the flag keeps its exact
  // field order and content. Every recorded feature is named: nothing is left to a bundle.
  if (optOutCreativeEnhancements) {
    body.degrees_of_freedom_spec = {
      creative_features_spec: Object.fromEntries(
        RECORDED_CREATIVE_FEATURES.map((feature) => [feature, { enroll_status: 'OPT_OUT' }]),
      ),
    };
  }

  return metaPost<{ id: string }>(`/${adAccountId}/adcreatives`, accessToken, body);
}

const AD_LAUNCH_READ_BACK_FIELDS =
  'id,name,adset_id,configured_status,effective_status,ad_review_feedback,' +
  'creative{id,name,object_story_spec,degrees_of_freedom_spec}';

/**
 * Read an ad and its creative back from Meta in one GET, for the checks that must pass before
 * the ad is switched on. Anything Meta omits comes back as null, which never passes a check.
 * Throws MetaApiError when Meta rejects the read (an expired token is code 190).
 */
export async function readMetaAdForLaunch(
  adId: string,
  accessToken: string,
): Promise<MetaAdLaunchReadBack> {
  const response = await metaGet<Record<string, unknown>>(`/${adId}`, accessToken, {
    fields: AD_LAUNCH_READ_BACK_FIELDS,
  });

  return {
    adId: asTrimmedString(response.id) ?? adId,
    name: asTrimmedString(response.name),
    adSetId: asTrimmedString(response.adset_id),
    configuredStatus: asTrimmedString(response.configured_status),
    effectiveStatus: asTrimmedString(response.effective_status),
    reviewFeedback: readReviewFeedback(response.ad_review_feedback),
    creative: shapeCreativeReadBack(asRecord(response.creative)),
  };
}

/** Read one creative by its id (a GET), to recover a creative whose id is already stored. */
export async function readMetaAdCreative(
  creativeId: string,
  accessToken: string,
): Promise<MetaCreativeLaunchReadBack> {
  const response = await metaGet<Record<string, unknown>>(`/${creativeId}`, accessToken, {
    fields: 'id,name,object_story_spec,degrees_of_freedom_spec',
  });
  return shapeCreativeReadBack(response);
}

/** One ad as an ad set lists it. */
export interface MetaAdSetAdSummary {
  id: string;
  name: string | null;
  configuredStatus: string | null;
  effectiveStatus: string | null;
  creativeId: string | null;
}

// Meta leaves archived ads out of an ad set's list unless they are asked for by status, so
// every status that can be listed is named. Deleted ads cannot be listed through an edge at
// all (Meta: they can only be read by id), so DELETED is not in the filter.
const LISTABLE_AD_STATUSES = [
  'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO',
  'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED',
];

/** Every ad in an ad set, whatever its status (GET only), so an ad can be found by its name. */
export async function listMetaAdSetAds(
  adSetId: string,
  accessToken: string,
): Promise<MetaAdSetAdSummary[]> {
  const rows = await metaGetAllPages(`/${adSetId}/ads`, accessToken, {
    fields: 'id,name,configured_status,effective_status,creative{id}',
    effective_status: JSON.stringify(LISTABLE_AD_STATUSES),
  });

  return rows
    .map((row): MetaAdSetAdSummary | null => {
      const id = asTrimmedString(row.id);
      if (!id) return null;
      return {
        id,
        name: asTrimmedString(row.name),
        configuredStatus: asTrimmedString(row.configured_status),
        effectiveStatus: asTrimmedString(row.effective_status),
        creativeId: asTrimmedString(asRecord(row.creative)?.id),
      };
    })
    .filter((row): row is MetaAdSetAdSummary => row !== null);
}

/** One creative as the ad account lists it. */
export interface MetaAdCreativeSummary {
  id: string;
  name: string | null;
  /** `object_story_spec.link_data.link`, or null for a creative built another way. */
  link: string | null;
}

/**
 * Every creative in the ad account carrying exactly this name (GET only). The account's
 * creatives are paged through and matched here rather than filtered by Meta, so the match is
 * exact and does not depend on a server-side filter.
 */
export async function listMetaAdCreativesNamed(
  adAccountId: string,
  accessToken: string,
  name: string,
): Promise<MetaAdCreativeSummary[]> {
  const rows = await metaGetAllPages(`/${adAccountId}/adcreatives`, accessToken, {
    fields: 'id,name,object_story_spec',
  });

  return rows
    .map((row): MetaAdCreativeSummary | null => {
      const id = asTrimmedString(row.id);
      if (!id) return null;
      const linkData = asRecord(asRecord(row.object_story_spec)?.link_data);
      return { id, name: asTrimmedString(row.name), link: asTrimmedString(linkData?.link) };
    })
    .filter((row): row is MetaAdCreativeSummary => row !== null && row.name === name);
}

/** The ad account's status and spending limit, in minor units (pence), read with one GET. */
export interface MetaAdAccountSpendStatus {
  /** 1 means active. */
  accountStatus: number | null;
  /** The account spending limit; null when Meta returns none (0 means no limit is set). */
  spendCapMinor: number | null;
  amountSpentMinor: number | null;
}

export async function fetchMetaAdAccountSpendStatus(
  adAccountId: string,
  accessToken: string,
): Promise<MetaAdAccountSpendStatus> {
  const response = await metaGet<Record<string, unknown>>(`/${adAccountId}`, accessToken, {
    fields: 'account_status,spend_cap,amount_spent',
  });

  return {
    accountStatus: normaliseMetaNumber(response.account_status),
    spendCapMinor: normaliseMetaNumber(response.spend_cap),
    amountSpentMinor: normaliseMetaNumber(response.amount_spent),
  };
}

/** What is left of an ad set's budget, in minor units (pence); null when Meta returns none. */
export async function fetchMetaAdSetBudgetRemaining(
  adSetId: string,
  accessToken: string,
): Promise<number | null> {
  const response = await metaGet<Record<string, unknown>>(`/${adSetId}`, accessToken, {
    fields: 'budget_remaining',
  });
  return normaliseMetaNumber(response.budget_remaining);
}

const META_LIST_PAGE_SIZE = 100;
// 50 pages of 100 is far more than this account holds. Reaching it means the list cannot be
// trusted to be complete, so the read fails rather than returning a partial answer.
const META_LIST_MAX_PAGES = 50;

async function metaGetAllPages(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let after: string | null = null;

  for (let page = 0; page < META_LIST_MAX_PAGES; page += 1) {
    const response: Record<string, unknown> = await metaGet<Record<string, unknown>>(path, accessToken, {
      ...params,
      limit: String(META_LIST_PAGE_SIZE),
      ...(after ? { after } : {}),
    });

    if (Array.isArray(response.data)) {
      for (const row of response.data) {
        const record = asRecord(row);
        if (record) rows.push(record);
      }
    }

    const paging = asRecord(response.paging);
    const nextAfter = asTrimmedString(asRecord(paging?.cursors)?.after);
    if (!paging?.next || !nextAfter || nextAfter === after) return rows;
    after = nextAfter;
  }

  throw new MetaApiError(`Meta returned more than ${META_LIST_MAX_PAGES} pages for ${path}; the list is not complete.`, 0);
}

function shapeCreativeReadBack(creative: Record<string, unknown> | null): MetaCreativeLaunchReadBack {
  const storySpec = asRecord(creative?.object_story_spec);
  const linkData = asRecord(storySpec?.link_data);
  const callToAction = asRecord(linkData?.call_to_action);
  const callToActionValue = asRecord(callToAction?.value);

  return {
    id: asTrimmedString(creative?.id),
    name: asTrimmedString(creative?.name),
    pageId: asTrimmedString(storySpec?.page_id),
    link: asTrimmedString(linkData?.link),
    message: asTrimmedString(linkData?.message),
    headline: asTrimmedString(linkData?.name),
    description: asTrimmedString(linkData?.description),
    callToActionType: asTrimmedString(callToAction?.type),
    callToActionLink: asTrimmedString(callToActionValue?.link),
    creativeFeaturesSpec: asRecord(asRecord(creative?.degrees_of_freedom_spec)?.creative_features_spec),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Any feedback at all is kept, whatever shape Meta sends it in; nothing or empty is null. */
function readReviewFeedback(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  const record = asRecord(value);
  if (record) return Object.keys(record).length > 0 ? record : null;
  if (Array.isArray(value)) return value.length > 0 ? { feedback: value } : null;
  if (typeof value === 'string') return value.trim() ? { feedback: value.trim() } : null;
  return { feedback: value };
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Whether Meta holds every recorded automatic creative change as opted out.
 *
 * - `fail`: any feature Meta returned is OPT_IN or carries a value that is not understood.
 * - `unverified`: the spec is missing or empty, or a recorded feature is absent. This is not a
 *   pass: an ad whose opt-out cannot be shown must not be switched on.
 * - `pass`: every recorded feature is present and OPT_OUT.
 *
 * A feature Meta returns that is not on the recorded list is still checked, so a newly added
 * feature that Meta has enrolled the creative in fails rather than slipping through.
 */
export function checkCreativeEnhancementsOptedOut(
  creativeFeaturesSpec: unknown,
): MetaLaunchCheck<CreativeEnhancementsCheckResult> {
  const spec = asRecord(creativeFeaturesSpec);
  const returned = spec ? Object.keys(spec) : [];

  const enrolled: string[] = [];
  const unknown: string[] = [];
  for (const feature of returned) {
    const status = readEnrollStatus(spec?.[feature]);
    if (status === 'OPT_OUT') continue;
    if (status === 'OPT_IN') enrolled.push(feature);
    else unknown.push(feature);
  }

  if (enrolled.length > 0 || unknown.length > 0) {
    const reasons: string[] = [];
    if (enrolled.length > 0) reasons.push(`opted in: ${enrolled.join(', ')}`);
    if (unknown.length > 0) reasons.push(`value not understood: ${unknown.join(', ')}`);
    return { result: 'fail', reasons };
  }

  if (returned.length === 0) {
    return { result: 'unverified', reasons: ['Meta returned no creative features'] };
  }

  const missing = RECORDED_CREATIVE_FEATURES.filter((feature) => !(feature in (spec ?? {})));
  if (missing.length > 0) {
    return { result: 'unverified', reasons: [`not returned by Meta: ${missing.join(', ')}`] };
  }

  return { result: 'pass', reasons: [] };
}

/** Meta returns `{ enroll_status: 'OPT_OUT' }`; a bare status string is read the same way. */
function readEnrollStatus(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().toUpperCase() || null;
  const status = asRecord(value)?.enroll_status;
  return typeof status === 'string' ? status.trim().toUpperCase() || null : null;
}

/**
 * Whether the creative's button and both of its links are what was meant to be sent. The app
 * sends BOOK_NOW as BOOK_TRAVEL (normaliseMetaCallToActionType), so both sides of the button
 * comparison are normalised the same way. The creative's own link and its button link must both
 * equal the expected link: one pointing anywhere else fails.
 */
export function checkCreativeCallToAction(
  creative: Pick<MetaCreativeLaunchReadBack, 'link' | 'callToActionType' | 'callToActionLink'>,
  expected: { type: string; link: string },
): MetaLaunchCheck<'pass' | 'fail'> {
  const reasons: string[] = [];

  const expectedType = normaliseMetaCallToActionType(expected.type.trim().toUpperCase());
  const actualType = creative.callToActionType
    ? normaliseMetaCallToActionType(creative.callToActionType.trim().toUpperCase())
    : null;
  if (!actualType) {
    reasons.push('Meta returned no button type');
  } else if (actualType !== expectedType) {
    reasons.push(`the button is ${actualType}, expected ${expectedType}`);
  }

  if (!isSameLink(creative.link, expected.link)) {
    reasons.push(`the creative link is ${creative.link ?? 'missing'}, expected ${expected.link}`);
  }
  if (!isSameLink(creative.callToActionLink, expected.link)) {
    reasons.push(`the button link is ${creative.callToActionLink ?? 'missing'}, expected ${expected.link}`);
  }

  return { result: reasons.length === 0 ? 'pass' : 'fail', reasons };
}

/** Same address, ignoring letter case in the host and a trailing slash on the path. */
function isSameLink(actual: string | null | undefined, expected: string): boolean {
  const left = parseLink(actual);
  const right = parseLink(expected);
  return Boolean(left && right && left === right);
}

function parseLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return null;
  }
}

// Meta has not finished reviewing the ad. No feedback yet is not approval.
const AD_REVIEW_IN_PROGRESS_STATUSES = new Set(['PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED']);
const AD_REVIEW_REJECTED_STATUSES = new Set(['DISAPPROVED', 'WITH_ISSUES']);

/**
 * Whether Meta has approved the ad in the state it was set to.
 *
 * - `fail`: Meta returned any review feedback or rejected the ad, the ad is not set to the
 *   expected status, or its effective status is one that review will not resolve.
 * - `pending`: Meta has not finished review, or returned no effective status.
 * - `pass`: no feedback, and both the configured and the effective status are the expected one.
 */
export function checkAdReview(
  ad: Pick<MetaAdLaunchReadBack, 'configuredStatus' | 'effectiveStatus' | 'reviewFeedback'>,
  expectedStatus: 'ACTIVE' | 'PAUSED',
): MetaLaunchCheck<AdReviewCheckResult> {
  const configured = ad.configuredStatus?.toUpperCase() ?? null;
  const effective = ad.effectiveStatus?.toUpperCase() ?? null;

  if (ad.reviewFeedback && Object.keys(ad.reviewFeedback).length > 0) {
    return { result: 'fail', reasons: [`Meta returned review feedback: ${JSON.stringify(ad.reviewFeedback)}`] };
  }
  if (effective && AD_REVIEW_REJECTED_STATUSES.has(effective)) {
    return { result: 'fail', reasons: [`Meta reports the ad as ${effective}`] };
  }
  if (configured !== expectedStatus) {
    return {
      result: 'fail',
      reasons: [`the ad is set to ${configured ?? 'an unknown status'}, expected ${expectedStatus}`],
    };
  }
  if (!effective) {
    return { result: 'pending', reasons: ['Meta returned no effective status'] };
  }
  if (effective === expectedStatus) {
    return { result: 'pass', reasons: [] };
  }
  if (AD_REVIEW_IN_PROGRESS_STATUSES.has(effective)) {
    return { result: 'pending', reasons: [`Meta has not finished review (${effective})`] };
  }
  return {
    result: 'fail',
    reasons: [`the ad's effective status is ${effective}, expected ${expectedStatus}`],
  };
}

export async function createMetaAd(params: CreateAdParams): Promise<{ id: string }> {
  const { accessToken, adAccountId, name, adsetId, creativeId, status } = params;

  return metaPost<{ id: string }>(
    `/${adAccountId}/ads`,
    accessToken,
    {
      name,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status,
    },
  );
}

export async function pauseMetaObject(
  objectId: string,
  accessToken: string,
): Promise<void> {
  await setMetaObjectStatus(objectId, accessToken, 'PAUSED');
}

export async function setMetaObjectStatus(
  objectId: string,
  accessToken: string,
  status: 'ACTIVE' | 'PAUSED',
): Promise<void> {
  await metaPost<Record<string, unknown>>(
    `/${objectId}`,
    accessToken,
    { status },
  );
}

export async function fetchMetaObjectInsights(
  objectId: string,
  accessToken: string,
  options?: MetaInsightsOptions,
): Promise<CampaignInsights> {
  interface InsightsResponse {
    data?: Array<{
      spend?: string;
      impressions?: string;
      reach?: string;
      clicks?: string;
      inline_link_clicks?: string;
      ctr?: string;
      cpc?: string;
      actions?: Array<{ action_type?: string; value?: string }>;
      cost_per_action_type?: Array<{ action_type?: string; value?: string }>;
    }>;
  }

  interface CampaignStatusResponse {
    status?: string;
    effective_status?: string;
    configured_status?: string;
  }

  const insightParams: Record<string, string> = {
    fields: 'spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,actions,cost_per_action_type',
  };
  if (options?.since && options.until) {
    insightParams.time_range = JSON.stringify({
      since: options.since,
      until: options.until,
    });
  } else {
    insightParams.date_preset = 'last_30d';
  }

  const [insightsResult, campaignResult] = await Promise.all([
    metaGet<InsightsResponse>(`/${objectId}/insights`, accessToken, insightParams),
    metaGet<CampaignStatusResponse>(`/${objectId}`, accessToken, {
      fields: 'status,effective_status,configured_status',
    }),
  ]);

  const row = insightsResult.data?.[0];
  const clicks =
    row?.inline_link_clicks !== undefined
      ? parseInt(row.inline_link_clicks, 10)
      : row?.clicks !== undefined
        ? parseInt(row.clicks, 10)
        : 0;
  const spend = row?.spend !== undefined ? parseFloat(row.spend) : 0;
  const conversions = sumPurchaseActions(row?.actions);
  const reactions = sumActionValues(row?.actions, 'post_reaction');
  const comments = sumActionValues(row?.actions, 'comment');
  const shares = sumActionValues(row?.actions, 'post');
  const reportedCostPerConversion = findPurchaseActionValue(row?.cost_per_action_type);
  const costPerConversion =
    reportedCostPerConversion > 0
      ? reportedCostPerConversion
      : conversions > 0
        ? spend / conversions
        : 0;
  const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0;

  return {
    spend,
    impressions: row?.impressions !== undefined ? parseInt(row.impressions, 10) : 0,
    reach: row?.reach !== undefined ? parseInt(row.reach, 10) : 0,
    clicks,
    ctr: row?.ctr !== undefined ? parseFloat(row.ctr) : 0,
    cpc: row?.cpc !== undefined ? parseFloat(row.cpc) : 0,
    conversions,
    reactions,
    comments,
    shares,
    costPerConversion,
    conversionRate,
    status: campaignResult.status ?? campaignResult.effective_status ?? campaignResult.configured_status ?? 'UNKNOWN',
  };
}

const PURCHASE_ACTION_TYPES = new Set([
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
  'omni_purchase',
  'onsite_conversion.purchase',
]);

function sumActionValues(
  actions: Array<{ action_type?: string; value?: string }> | undefined,
  actionType: string,
): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((total, action) => {
    if (action.action_type !== actionType) return total;
    const parsed = Number(action.value ?? 0);
    return Number.isFinite(parsed) && parsed >= 0 ? total + parsed : total;
  }, 0);
}

function sumPurchaseActions(actions: Array<{ action_type?: string; value?: string }> | undefined): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((total, action) => {
    if (!action.action_type || !PURCHASE_ACTION_TYPES.has(action.action_type)) return total;
    const parsed = Number(action.value ?? 0);
    return Number.isFinite(parsed) ? total + parsed : total;
  }, 0);
}

function findPurchaseActionValue(actions: Array<{ action_type?: string; value?: string }> | undefined): number {
  if (!Array.isArray(actions)) return 0;
  const match = actions.find((action) => action.action_type && PURCHASE_ACTION_TYPES.has(action.action_type));
  if (!match) return 0;
  const parsed = Number(match.value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchCampaignInsights(
  campaignId: string,
  accessToken: string,
  options?: MetaInsightsOptions,
): Promise<CampaignInsights> {
  return fetchMetaObjectInsights(campaignId, accessToken, options);
}
