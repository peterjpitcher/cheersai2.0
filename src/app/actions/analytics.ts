'use server';

import { requireAuthContext } from '@/lib/auth/server';
import {
  getPostAnalytics,
  getEngagementByPlatform,
  getEngagementByContentType,
  getBestDayTimeSlots,
} from '@/lib/analytics/queries';
import type {
  DateRange,
  PostAnalytics,
  PlatformEngagement,
  ContentTypePerformance,
  BestTimeSlot,
} from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// Analytics server actions — wraps query functions with auth context
// ---------------------------------------------------------------------------

/**
 * Fetch per-post analytics for the authenticated account.
 */
export async function getAnalyticsData(
  dateRange: DateRange,
): Promise<{ data?: PostAnalytics[]; error?: string }> {
  try {
    const { accountId } = await requireAuthContext();
    const data = await getPostAnalytics(accountId, dateRange);
    return { data };
  } catch (err) {
    console.error('[analytics-action] getAnalyticsData error:', err);
    return { error: 'Failed to load analytics data' };
  }
}

/**
 * Fetch platform-level engagement comparison.
 */
export async function getPlatformComparison(
  dateRange: DateRange,
): Promise<{ data?: PlatformEngagement[]; error?: string }> {
  try {
    const { accountId } = await requireAuthContext();
    const data = await getEngagementByPlatform(accountId, dateRange);
    return { data };
  } catch (err) {
    console.error('[analytics-action] getPlatformComparison error:', err);
    return { error: 'Failed to load platform comparison' };
  }
}

/**
 * Fetch content-type-level engagement comparison.
 */
export async function getContentTypeComparison(
  dateRange: DateRange,
): Promise<{ data?: ContentTypePerformance[]; error?: string }> {
  try {
    const { accountId } = await requireAuthContext();
    const data = await getEngagementByContentType(accountId, dateRange);
    return { data };
  } catch (err) {
    console.error('[analytics-action] getContentTypeComparison error:', err);
    return { error: 'Failed to load content type comparison' };
  }
}

/**
 * Fetch best day/time slots for posting.
 */
export async function getBestTimes(): Promise<{ data?: BestTimeSlot[]; error?: string }> {
  try {
    const { accountId } = await requireAuthContext();
    const data = await getBestDayTimeSlots(accountId);
    return { data };
  } catch (err) {
    console.error('[analytics-action] getBestTimes error:', err);
    return { error: 'Failed to load best posting times' };
  }
}
