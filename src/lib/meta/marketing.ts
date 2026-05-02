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
  const { accessToken, adAccountId, name, objective, specialAdCategory, status } = params;

  const specialAdCategories = specialAdCategory === 'NONE' ? [] : [specialAdCategory];
  const body: Record<string, unknown> = {
    name,
    objective,
    status,
    special_ad_categories: specialAdCategories,
    is_adset_budget_sharing_enabled: false,
  };

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
  } = params;

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

  return metaPost<{ id: string }>(`/${adAccountId}/adsets`, accessToken, body);
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
    linkData.call_to_action = { type: callToActionType, value: { link: linkUrl } };
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
  await metaPost<Record<string, unknown>>(
    `/${objectId}`,
    accessToken,
    { status: 'PAUSED' },
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
    }>;
  }

  interface CampaignStatusResponse {
    status?: string;
    effective_status?: string;
    configured_status?: string;
  }

  const insightParams: Record<string, string> = {
    fields: 'spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc',
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

  return {
    spend: row?.spend !== undefined ? parseFloat(row.spend) : 0,
    impressions: row?.impressions !== undefined ? parseInt(row.impressions, 10) : 0,
    reach: row?.reach !== undefined ? parseInt(row.reach, 10) : 0,
    clicks:
      row?.inline_link_clicks !== undefined
        ? parseInt(row.inline_link_clicks, 10)
        : row?.clicks !== undefined
          ? parseInt(row.clicks, 10)
          : 0,
    ctr: row?.ctr !== undefined ? parseFloat(row.ctr) : 0,
    cpc: row?.cpc !== undefined ? parseFloat(row.cpc) : 0,
    status: campaignResult.status ?? campaignResult.effective_status ?? campaignResult.configured_status ?? 'UNKNOWN',
  };
}

export async function fetchCampaignInsights(
  campaignId: string,
  accessToken: string,
  options?: MetaInsightsOptions,
): Promise<CampaignInsights> {
  return fetchMetaObjectInsights(campaignId, accessToken, options);
}
