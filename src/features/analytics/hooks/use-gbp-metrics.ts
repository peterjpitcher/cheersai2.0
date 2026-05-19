'use client';

import { useQuery } from '@tanstack/react-query';

import { getGbpMetrics } from '@/app/actions/analytics';
import type { DateRange } from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// React Query hook for GBP location metrics
// ---------------------------------------------------------------------------

const STALE_TIME = 60_000; // 1 minute

/**
 * Fetch GBP daily location metrics for the current account and date range.
 */
export function useGbpMetrics(dateRange: DateRange) {
  return useQuery({
    queryKey: ['analytics', 'gbp', dateRange.start, dateRange.end],
    queryFn: async () => {
      const result = await getGbpMetrics(dateRange);
      if (result.error) throw new Error(result.error);
      return result.data ?? [];
    },
    enabled: true,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}
