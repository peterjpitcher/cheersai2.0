import { getMetaGraphApiBase } from '@/lib/meta/graph';

// ─── Error class ─────────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly subcode?: number,
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

// ─── Private helpers ──────────────────────────────────────────────────────────

interface MetaErrorPayload {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
}

function extractMetaError(payload: unknown): { message: string; code: number; subcode?: number } {
  const p = payload as MetaErrorPayload;
  if (p?.error) {
    return {
      message: p.error.message ?? 'Meta API error',
      code: p.error.code ?? 0,
      subcode: p.error.error_subcode,
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
    const { message, code, subcode } = extractMetaError(json);
    throw new MetaApiError(message, code, subcode);
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
    const { message, code, subcode } = extractMetaError(json);
    throw new MetaApiError(message, code, subcode);
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

export async function fetchCampaignInsights(
  campaignId: string,
  accessToken: string,
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
  }

  const [insightsResult, campaignResult] = await Promise.all([
    metaGet<InsightsResponse>(`/${campaignId}/insights`, accessToken, {
      fields: 'spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc',
      date_preset: 'last_30d',
    }),
    metaGet<CampaignStatusResponse>(`/${campaignId}`, accessToken, {
      fields: 'status',
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
    status: campaignResult.status ?? 'UNKNOWN',
  };
}
