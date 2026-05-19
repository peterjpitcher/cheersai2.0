/**
 * Pure aggregation functions for analytics data transformation.
 * No database access -- these operate on in-memory data only.
 * Used by query functions and the analytics dashboard UI.
 */

import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';

import type {
  PostAnalytics,
  PlatformEngagement,
  ContentTypePerformance,
  BestTimeSlot,
  AnalyticsEmptyReason,
} from './types';

/**
 * Group analytics rows by platform and compute weighted engagement rate.
 * Weighted rate = sum(engagementCount) / sum(impressions).
 */
export function aggregateByPlatform(rows: PostAnalytics[]): PlatformEngagement[] {
  if (rows.length === 0) return [];

  const groups = new Map<string, { impressions: number; engagement: number; count: number }>();

  for (const row of rows) {
    const key = row.platform;
    const existing = groups.get(key) ?? { impressions: 0, engagement: 0, count: 0 };
    existing.impressions += row.impressions ?? 0;
    existing.engagement += row.engagementCount ?? 0;
    existing.count += 1;
    groups.set(key, existing);
  }

  const result: PlatformEngagement[] = [];
  for (const [platform, agg] of groups) {
    result.push({
      platform: platform as PlatformEngagement['platform'],
      totalImpressions: agg.impressions,
      totalEngagement: agg.engagement,
      weightedEngagementRate: agg.impressions > 0 ? agg.engagement / agg.impressions : 0,
      postCount: agg.count,
    });
  }

  return result;
}

/**
 * Group analytics rows by content type and compute weighted engagement rate.
 * Rows with null contentType are grouped under "unknown".
 */
export function aggregateByContentType(rows: PostAnalytics[]): ContentTypePerformance[] {
  if (rows.length === 0) return [];

  const groups = new Map<string, { impressions: number; engagement: number; count: number }>();

  for (const row of rows) {
    const key = row.contentType ?? 'unknown';
    const existing = groups.get(key) ?? { impressions: 0, engagement: 0, count: 0 };
    existing.impressions += row.impressions ?? 0;
    existing.engagement += row.engagementCount ?? 0;
    existing.count += 1;
    groups.set(key, existing);
  }

  const result: ContentTypePerformance[] = [];
  for (const [contentType, agg] of groups) {
    result.push({
      contentType,
      totalImpressions: agg.impressions,
      totalEngagement: agg.engagement,
      weightedEngagementRate: agg.impressions > 0 ? agg.engagement / agg.impressions : 0,
      postCount: agg.count,
    });
  }

  return result;
}

/**
 * Identify top-performing day-of-week + hour slots from historical publish data.
 * Parses scheduledFor with Luxon in Europe/London timezone.
 * Returns top 5 slots sorted by average engagement rate descending.
 */
export function computeBestTimeSlots(
  items: Array<{ scheduledFor: string; engagementRate: number | null }>,
): BestTimeSlot[] {
  if (items.length === 0) return [];

  const groups = new Map<string, { totalRate: number; count: number; dayOfWeek: number; hour: number }>();

  for (const item of items) {
    if (item.engagementRate === null) continue;

    const dt = DateTime.fromISO(item.scheduledFor, { zone: DEFAULT_TIMEZONE });
    if (!dt.isValid) continue;

    const dayOfWeek = dt.weekday % 7; // Luxon weekday: 1=Mon..7=Sun -> 0=Sun convention: 7%7=0
    const hour = dt.hour;
    const key = `${dayOfWeek}-${hour}`;

    const existing = groups.get(key) ?? { totalRate: 0, count: 0, dayOfWeek, hour };
    existing.totalRate += item.engagementRate;
    existing.count += 1;
    groups.set(key, existing);
  }

  const slots: BestTimeSlot[] = [];
  for (const [, agg] of groups) {
    slots.push({
      dayOfWeek: agg.dayOfWeek,
      hour: agg.hour,
      avgEngagementRate: agg.count > 0 ? agg.totalRate / agg.count : 0,
      postCount: agg.count,
    });
  }

  // Sort descending by avgEngagementRate, return top 5
  slots.sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
  return slots.slice(0, 5);
}

/**
 * Compute engagement rate as engagement_count / impressions.
 * Returns null when impressions is 0 to avoid division by zero.
 */
export function computeEngagementRate(engagementCount: number, impressions: number): number | null {
  if (impressions === 0) return null;
  return engagementCount / impressions;
}

/**
 * Describe why analytics data is empty or unavailable.
 * Returns a descriptive reason string per ANLY-06, or null when data is present.
 */
export function describeEmptyReason(context: {
  publishJobCount: number;
  snapshotCount: number;
  isGbp?: boolean;
  daysFromNow?: number;
  isConnected?: boolean;
}): AnalyticsEmptyReason {
  // Platform not connected takes priority
  if (context.isConnected === false) {
    return 'platform_not_connected';
  }

  // No published content at all
  if (context.publishJobCount === 0 && context.snapshotCount === 0) {
    return 'no_published_content';
  }

  // GBP data delay: metrics within 3-day window
  if (context.isGbp && context.daysFromNow !== undefined && context.daysFromNow < 3) {
    return 'gbp_data_delayed';
  }

  // Published content exists but no metrics yet
  if (context.publishJobCount > 0 && context.snapshotCount === 0) {
    return 'no_metrics_yet';
  }

  // Data is present
  return null;
}
