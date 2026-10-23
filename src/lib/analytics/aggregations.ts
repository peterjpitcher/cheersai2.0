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

interface RateTotals {
  impressions: number;
  engagement: number;
  /** Views and engagement of only the rows Meta returned views for, so the rate compares like with like. */
  ratedImpressions: number;
  ratedEngagement: number;
  count: number;
}

function addRow(totals: RateTotals | undefined, row: PostAnalytics): RateTotals {
  const next = totals ?? { impressions: 0, engagement: 0, ratedImpressions: 0, ratedEngagement: 0, count: 0 };
  next.impressions += row.impressions ?? 0;
  next.engagement += row.engagementCount ?? 0;
  if (row.impressions !== null && row.impressions > 0) {
    next.ratedImpressions += row.impressions;
    next.ratedEngagement += row.engagementCount ?? 0;
  }
  next.count += 1;
  return next;
}

const weightedRate = (totals: RateTotals): number =>
  totals.ratedImpressions > 0 ? totals.ratedEngagement / totals.ratedImpressions : 0;

/**
 * Group analytics rows by platform and compute weighted engagement rate.
 * Weighted rate = sum(engagementCount) / sum(impressions), over only the rows that have
 * impressions: a post Meta has not returned views for (its platform not yet reconnected with the
 * results permissions) would otherwise add engagement with nothing to divide it by.
 */
export function aggregateByPlatform(rows: PostAnalytics[]): PlatformEngagement[] {
  if (rows.length === 0) return [];

  const groups = new Map<string, RateTotals>();
  for (const row of rows) groups.set(row.platform, addRow(groups.get(row.platform), row));

  const result: PlatformEngagement[] = [];
  for (const [platform, agg] of groups) {
    result.push({
      platform: platform as PlatformEngagement['platform'],
      totalImpressions: agg.impressions,
      totalEngagement: agg.engagement,
      weightedEngagementRate: weightedRate(agg),
      postCount: agg.count,
    });
  }

  return result;
}

/**
 * Group analytics rows by content type and compute weighted engagement rate, over only the rows
 * that have impressions (see aggregateByPlatform). Rows with null contentType are grouped under
 * "unknown".
 */
export function aggregateByContentType(rows: PostAnalytics[]): ContentTypePerformance[] {
  if (rows.length === 0) return [];

  const groups = new Map<string, RateTotals>();
  for (const row of rows) {
    const key = row.contentType ?? 'unknown';
    groups.set(key, addRow(groups.get(key), row));
  }

  const result: ContentTypePerformance[] = [];
  for (const [contentType, agg] of groups) {
    result.push({
      contentType,
      totalImpressions: agg.impressions,
      totalEngagement: agg.engagement,
      weightedEngagementRate: weightedRate(agg),
      postCount: agg.count,
    });
  }

  return result;
}

export interface PostResultsSummary {
  impressions: number;
  /** People reached; null until Meta has returned reach for at least one post. */
  reach: number | null;
  /** Null until Meta has returned reach or views for at least one post. */
  engagementRate: number | null;
  clicks: number;
  postCount: number;
}

const sumOf = (values: Array<number | null>): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

/**
 * The Analytics overview's totals. The engagement rate is over reach where Meta returned reach,
 * otherwise over views, and its numerator and denominator always come from the same posts: a
 * post without the figure (its platform not yet reconnected with the results permissions) never
 * inflates the rate.
 */
export function summarisePostResults(rows: PostAnalytics[]): PostResultsSummary {
  const withReach = rows.filter((row) => row.reach !== null && row.reach > 0);
  const withViews = rows.filter((row) => row.impressions !== null && row.impressions > 0);
  const rated = withReach.length
    ? { rows: withReach, base: sumOf(withReach.map((row) => row.reach)) }
    : { rows: withViews, base: sumOf(withViews.map((row) => row.impressions)) };
  return {
    impressions: sumOf(rows.map((row) => row.impressions)),
    reach: rows.some((row) => row.reach !== null) ? sumOf(rows.map((row) => row.reach)) : null,
    engagementRate: rated.base > 0 ? sumOf(rated.rows.map((row) => row.engagementCount)) / rated.base : null,
    clicks: sumOf(rows.map((row) => row.clicks)),
    postCount: rows.length,
  };
}

/** Whether a stored row carries any result yet: counts arrive before reach and views do. */
export function hasPostResults(row: PostAnalytics): boolean {
  return [row.impressions, row.reach, row.engagementCount, row.clicks, row.shares, row.comments].some(
    (value) => value !== null,
  );
}

/**
 * What the overview says when a platform's posts have no reach yet, which means its connection
 * lacks the results permissions (tasks/SPEC-post-results.md), or null when nothing is missing.
 * Only Facebook posts carry links, so link clicks are named only for Facebook.
 */
export function reconnectNote(rows: PostAnalytics[]): string | null {
  const platforms = (['facebook', 'instagram'] as const).filter(
    (platform) => rows.some((row) => row.platform === platform) && !rows.some((row) => row.platform === platform && row.reach !== null),
  );
  if (!platforms.length) return null;
  const figures = platforms.includes('facebook') ? 'People reached and link clicks' : 'People reached';
  const cards = platforms.map((platform) => (platform === 'facebook' ? 'Facebook Page' : 'Instagram Business'));
  return `${figures} will show once the results permissions are granted: open Connections and click Update connection on the ${cards.join(' and ')} card${cards.length > 1 ? 's' : ''}.`;
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

  // Published content exists but no metrics yet
  if (context.publishJobCount > 0 && context.snapshotCount === 0) {
    return 'no_metrics_yet';
  }

  // Data is present
  return null;
}
