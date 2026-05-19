/**
 * Supabase queries for analytics dashboard data.
 * Uses service-role client for cross-table joins.
 * All functions are account-scoped for data isolation.
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';

import { aggregateByPlatform, aggregateByContentType, computeBestTimeSlots } from './aggregations';
import type {
  DateRange,
  PostAnalytics,
  PlatformEngagement,
  ContentTypePerformance,
  BestTimeSlot,
  GbpLocationMetrics,
} from './types';

// ---------------------------------------------------------------------------
// Raw DB row types (snake_case)
// ---------------------------------------------------------------------------

interface AnalyticsSnapshotRow {
  publish_job_id: string;
  platform: 'facebook' | 'instagram' | 'gbp';
  impressions: number | null;
  reach: number | null;
  engagement_count: number | null;
  engagement_rate: number | null;
  clicks: number | null;
  shares: number | null;
  comments: number | null;
  snapshot_date: string;
  publish_jobs: {
    content_item_id: string | null;
    scheduled_for: string | null;
    content_items: {
      content_type: string | null;
    } | null;
  } | null;
}

interface GbpDailyMetricsRow {
  metric_date: string;
  search_views: number | null;
  map_views: number | null;
  website_clicks: number | null;
  direction_requests: number | null;
  phone_calls: number | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapSnapshotToPostAnalytics(row: AnalyticsSnapshotRow): PostAnalytics {
  return {
    publishJobId: row.publish_job_id,
    platform: row.platform,
    impressions: row.impressions,
    reach: row.reach,
    engagementCount: row.engagement_count,
    engagementRate: row.engagement_rate,
    clicks: row.clicks,
    shares: row.shares,
    comments: row.comments,
    snapshotDate: row.snapshot_date,
    contentItemId: row.publish_jobs?.content_item_id ?? null,
    contentType: row.publish_jobs?.content_items?.content_type ?? null,
    scheduledFor: row.publish_jobs?.scheduled_for ?? null,
  };
}

function mapGbpRow(row: GbpDailyMetricsRow): GbpLocationMetrics {
  return {
    metricDate: row.metric_date,
    searchViews: row.search_views,
    mapViews: row.map_views,
    websiteClicks: row.website_clicks,
    directionRequests: row.direction_requests,
    phoneCalls: row.phone_calls,
  };
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Fetch per-post analytics for an account within a date range.
 * Joins analytics_snapshots -> publish_jobs -> content_items for content metadata.
 */
export async function getPostAnalytics(
  accountId: string,
  dateRange: DateRange,
): Promise<PostAnalytics[]> {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('analytics_snapshots')
    .select(
      'publish_job_id, platform, impressions, reach, engagement_count, engagement_rate, clicks, shares, comments, snapshot_date, publish_jobs(content_item_id, scheduled_for, content_items(content_type))',
    )
    .eq('account_id', accountId)
    .gte('snapshot_date', dateRange.start)
    .lte('snapshot_date', dateRange.end)
    .returns<AnalyticsSnapshotRow[]>();

  if (error || !data) {
    console.error('[analytics] Failed to fetch post analytics:', error?.message);
    return [];
  }

  return data.map(mapSnapshotToPostAnalytics);
}

/**
 * Get engagement aggregated by platform for an account within a date range.
 */
export async function getEngagementByPlatform(
  accountId: string,
  dateRange: DateRange,
): Promise<PlatformEngagement[]> {
  const posts = await getPostAnalytics(accountId, dateRange);
  return aggregateByPlatform(posts);
}

/**
 * Get engagement aggregated by content type for an account within a date range.
 */
export async function getEngagementByContentType(
  accountId: string,
  dateRange: DateRange,
): Promise<ContentTypePerformance[]> {
  const posts = await getPostAnalytics(accountId, dateRange);
  return aggregateByContentType(posts);
}

/**
 * Get top 5 best-performing day-of-week + hour slots for an account.
 * Uses all-time data from publish_jobs with status='posted' joined to analytics_snapshots.
 */
export async function getBestDayTimeSlots(accountId: string): Promise<BestTimeSlot[]> {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('analytics_snapshots')
    .select(
      'engagement_rate, publish_jobs(scheduled_for)',
    )
    .eq('account_id', accountId)
    .returns<Array<{
      engagement_rate: number | null;
      publish_jobs: { scheduled_for: string | null } | null;
    }>>();

  if (error || !data) {
    console.error('[analytics] Failed to fetch best time slots:', error?.message);
    return [];
  }

  const items = data
    .filter((row): row is typeof row & { publish_jobs: { scheduled_for: string } } =>
      row.publish_jobs?.scheduled_for !== null && row.publish_jobs?.scheduled_for !== undefined,
    )
    .map(row => ({
      scheduledFor: row.publish_jobs.scheduled_for,
      engagementRate: row.engagement_rate,
    }));

  return computeBestTimeSlots(items);
}

/**
 * Fetch GBP daily location metrics for an account within a date range.
 */
export async function getGbpDailyMetrics(
  accountId: string,
  dateRange: DateRange,
): Promise<GbpLocationMetrics[]> {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('gbp_daily_metrics')
    .select('metric_date, search_views, map_views, website_clicks, direction_requests, phone_calls')
    .eq('account_id', accountId)
    .gte('metric_date', dateRange.start)
    .lte('metric_date', dateRange.end)
    .order('metric_date', { ascending: true })
    .returns<GbpDailyMetricsRow[]>();

  if (error || !data) {
    console.error('[analytics] Failed to fetch GBP daily metrics:', error?.message);
    return [];
  }

  return data.map(mapGbpRow);
}
