/**
 * GBP Performance API client for daily metrics collection (ANLY-04).
 * Fetches location-level engagement metrics from Google Business Profile
 * and stores them in the gbp_daily_metrics table.
 *
 * API Reference: https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';

const GBP_PERFORMANCE_API_BASE = 'https://businessprofileperformance.googleapis.com/v1';

/** Metrics we request from the GBP Performance API */
const DAILY_METRICS = [
  'WEBSITE_CLICKS',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_PROFILE_VIEWS_SEARCH',
  'BUSINESS_PROFILE_VIEWS_MAPS',
] as const;

/** Parsed daily metric for a single date */
interface ParsedDailyMetric {
  metricDate: string;
  searchViews: number | null;
  mapViews: number | null;
  websiteClicks: number | null;
  directionRequests: number | null;
  phoneCalls: number | null;
}

/** Raw API response shape from GBP Performance API */
interface GbpTimeSeries {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: {
      dailyMetric?: string;
      timeSeries?: {
        datedValues?: Array<{
          date?: { year?: number; month?: number; day?: number };
          value?: string;
        }>;
      };
    };
  }>;
}

/**
 * Response type from fetchGbpDailyMetrics
 */
export interface GbpApiMetricsResponse {
  metrics: ParsedDailyMetric[];
  raw: GbpTimeSeries | null;
}

/**
 * Format a GBP date object (year/month/day) to ISO date string.
 */
function formatGbpDate(date: { year?: number; month?: number; day?: number }): string | null {
  if (!date.year || !date.month || !date.day) return null;
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

/**
 * Parse the GBP Performance API response into per-day metric records.
 */
function parseTimeSeries(raw: GbpTimeSeries): ParsedDailyMetric[] {
  const dateMap = new Map<string, ParsedDailyMetric>();

  for (const entry of raw.multiDailyMetricTimeSeries ?? []) {
    const metric = entry.dailyMetricTimeSeries?.dailyMetric;
    const values = entry.dailyMetricTimeSeries?.timeSeries?.datedValues ?? [];

    for (const dv of values) {
      if (!dv.date) continue;
      const dateStr = formatGbpDate(dv.date);
      if (!dateStr) continue;

      const existing = dateMap.get(dateStr) ?? {
        metricDate: dateStr,
        searchViews: null,
        mapViews: null,
        websiteClicks: null,
        directionRequests: null,
        phoneCalls: null,
      };

      const value = dv.value ? parseInt(dv.value, 10) : null;

      switch (metric) {
        case 'BUSINESS_PROFILE_VIEWS_SEARCH':
          existing.searchViews = value;
          break;
        case 'BUSINESS_PROFILE_VIEWS_MAPS':
          existing.mapViews = value;
          break;
        case 'WEBSITE_CLICKS':
          existing.websiteClicks = value;
          break;
        case 'BUSINESS_DIRECTION_REQUESTS':
          existing.directionRequests = value;
          break;
        case 'CALL_CLICKS':
          existing.phoneCalls = value;
          break;
      }

      dateMap.set(dateStr, existing);
    }
  }

  return Array.from(dateMap.values()).sort((a, b) => a.metricDate.localeCompare(b.metricDate));
}

/**
 * Fetch daily metrics from the GBP Performance API.
 *
 * Calls GET fetchMultiDailyMetricsTimeSeries for the given location.
 * Handles 429 (rate limit) and 401/403 (auth) gracefully by returning empty results.
 *
 * @param accessToken - Fresh GBP OAuth access token
 * @param locationName - GBP location resource name (e.g., "locations/12345")
 * @param dateRange - Start and end dates for metric retrieval
 */
export async function fetchGbpDailyMetrics(
  accessToken: string,
  locationName: string,
  dateRange: { startDate: string; endDate: string },
): Promise<GbpApiMetricsResponse> {
  // Parse date strings into GBP API date format
  const startParts = dateRange.startDate.split('-').map(Number);
  const endParts = dateRange.endDate.split('-').map(Number);

  const params = new URLSearchParams({
    'dailyMetrics': DAILY_METRICS.join(','),
    'dailyRange.startDate.year': String(startParts[0]),
    'dailyRange.startDate.month': String(startParts[1]),
    'dailyRange.startDate.day': String(startParts[2]),
    'dailyRange.endDate.year': String(endParts[0]),
    'dailyRange.endDate.month': String(endParts[1]),
    'dailyRange.endDate.day': String(endParts[2]),
  });

  const url = `${GBP_PERFORMANCE_API_BASE}/${locationName}:fetchMultiDailyMetricsTimeSeries?${params}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    console.error('[gbp-metrics] Network error fetching GBP metrics:', err instanceof Error ? err.message : String(err));
    return { metrics: [], raw: null };
  }

  // Handle rate limiting (429) -- advisory, do not throw
  if (response.status === 429) {
    console.warn('[gbp-metrics] Rate limited by GBP Performance API. Will retry on next cron run.');
    return { metrics: [], raw: null };
  }

  // Handle auth errors (401/403) -- token may be expired, cron will retry next day
  if (response.status === 401 || response.status === 403) {
    console.warn(`[gbp-metrics] Auth error (${response.status}) for ${locationName}. Token may be expired.`);
    return { metrics: [], raw: null };
  }

  if (!response.ok) {
    console.error(`[gbp-metrics] Unexpected API error ${response.status} for ${locationName}`);
    return { metrics: [], raw: null };
  }

  const raw = (await response.json()) as GbpTimeSeries;
  const metrics = parseTimeSeries(raw);

  return { metrics, raw };
}

/**
 * Store GBP daily metrics in the gbp_daily_metrics table.
 * Uses service-role client to bypass RLS (system/cron operation).
 * Upserts on (social_connection_id, metric_date) conflict.
 *
 * @param accountId - Account owning the GBP connection
 * @param connectionId - social_connections.id for this GBP connection
 * @param metrics - Array of daily metric records to upsert
 * @param rawData - Optional raw API response for storage in raw_data JSONB
 */
export async function storeGbpDailyMetrics(
  accountId: string,
  connectionId: string,
  metrics: ParsedDailyMetric[],
  rawData?: GbpTimeSeries | null,
): Promise<void> {
  if (metrics.length === 0) return;

  // admin operation: cron job upserting GBP metrics collected from Performance API
  const supabase = createServiceSupabaseClient();

  const rows = metrics.map(m => ({
    account_id: accountId,
    social_connection_id: connectionId,
    metric_date: m.metricDate,
    search_views: m.searchViews,
    map_views: m.mapViews,
    website_clicks: m.websiteClicks,
    direction_requests: m.directionRequests,
    phone_calls: m.phoneCalls,
    raw_data: rawData ?? null,
  }));

  const { error } = await supabase
    .from('gbp_daily_metrics')
    .upsert(rows, { onConflict: 'social_connection_id,metric_date' });

  if (error) {
    console.error('[gbp-metrics] Failed to store GBP daily metrics:', error.message);
    throw new Error(`Failed to store GBP daily metrics: ${error.message}`);
  }
}
