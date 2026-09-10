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

function normaliseMetaCallToActionType(value: string): string {
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

  return metaPost<{ id: string }>(
    `/${adAccountId}/adcreatives`,
    accessToken,
    {
      name,
      object_story_spec: {
        page_id: pageId,
        link_data: linkData,
      },
    },
  );
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
