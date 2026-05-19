'use client';

import { useQuery } from '@tanstack/react-query';

import {
  getAnalyticsData,
  getPlatformComparison,
  getContentTypeComparison,
  getBestTimes,
} from '@/app/actions/analytics';
import type { DateRange } from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// React Query hooks for analytics data
// ---------------------------------------------------------------------------

const STALE_TIME = 60_000; // 1 minute
const BEST_TIMES_STALE = 5 * 60_000; // 5 minutes

/**
 * Fetch per-post analytics for the current account and date range.
 */
export function useAnalyticsData(dateRange: DateRange) {
  return useQuery({
    queryKey: ['analytics', 'posts', dateRange.start, dateRange.end],
    queryFn: async () => {
      const result = await getAnalyticsData(dateRange);
      if (result.error) throw new Error(result.error);
      return result.data ?? [];
    },
    enabled: true,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch engagement aggregated by platform.
 */
export function usePlatformComparison(dateRange: DateRange) {
  return useQuery({
    queryKey: ['analytics', 'platform', dateRange.start, dateRange.end],
    queryFn: async () => {
      const result = await getPlatformComparison(dateRange);
      if (result.error) throw new Error(result.error);
      return result.data ?? [];
    },
    enabled: true,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch engagement aggregated by content type.
 */
export function useContentTypeComparison(dateRange: DateRange) {
  return useQuery({
    queryKey: ['analytics', 'content-type', dateRange.start, dateRange.end],
    queryFn: async () => {
      const result = await getContentTypeComparison(dateRange);
      if (result.error) throw new Error(result.error);
      return result.data ?? [];
    },
    enabled: true,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch best day/time slots (all-time, not date-range scoped).
 */
export function useBestTimes() {
  return useQuery({
    queryKey: ['analytics', 'best-times'],
    queryFn: async () => {
      const result = await getBestTimes();
      if (result.error) throw new Error(result.error);
      return result.data ?? [];
    },
    enabled: true,
    staleTime: BEST_TIMES_STALE,
    refetchOnWindowFocus: false,
  });
}
