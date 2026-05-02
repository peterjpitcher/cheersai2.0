import type { CampaignPerformanceMetrics } from '@/types/campaigns';

export type PerformanceTone = 'best' | 'good' | 'weak' | 'neutral';
export type PerformanceToneMetric = 'clicks' | 'ctr' | 'cpc';

interface PerformanceSortable {
  id: string;
  performance: CampaignPerformanceMetrics;
}

export function sortAdsByPerformance<T extends PerformanceSortable>(ads: T[]): T[] {
  return ads
    .map((ad, index) => ({ ad, index }))
    .sort((left, right) => {
      const leftPerformance = left.ad.performance;
      const rightPerformance = right.ad.performance;
      const clicksDifference = rightPerformance.clicks - leftPerformance.clicks;
      if (clicksDifference !== 0) return clicksDifference;

      const leftCpc = sortableCpc(leftPerformance.cpc);
      const rightCpc = sortableCpc(rightPerformance.cpc);
      if (leftCpc !== rightCpc) return leftCpc - rightCpc;

      const ctrDifference = rightPerformance.ctr - leftPerformance.ctr;
      if (ctrDifference !== 0) return ctrDifference;

      const spendDifference = rightPerformance.spend - leftPerformance.spend;
      if (spendDifference !== 0) return spendDifference;

      return left.index - right.index;
    })
    .map(({ ad }) => ad);
}

export function hasRankableAdPerformance(ad: PerformanceSortable | undefined): boolean {
  return Boolean(ad && ad.performance.clicks > 0);
}

export function getPerformanceTone(
  metric: PerformanceToneMetric,
  value: number,
  context: CampaignPerformanceMetrics[],
): PerformanceTone {
  if (metric === 'cpc') {
    const positiveValues = context
      .map((performance) => performance.cpc)
      .filter((candidate) => candidate > 0);

    if (value <= 0 || positiveValues.length === 0) return 'neutral';

    const best = Math.min(...positiveValues);
    const weakest = Math.max(...positiveValues);
    if (value === best) return 'best';
    if (positiveValues.length >= 2 && value === weakest) return 'weak';
    return 'good';
  }

  const positiveValues = context
    .map((performance) => performance[metric])
    .filter((candidate) => candidate > 0);

  if (value <= 0 || positiveValues.length === 0) return 'neutral';

  const best = Math.max(...positiveValues);
  const weakest = Math.min(...positiveValues);
  if (value === best) return 'best';
  if (positiveValues.length >= 2 && value === weakest) return 'weak';
  return 'good';
}

function sortableCpc(value: number): number {
  return value > 0 ? value : Number.POSITIVE_INFINITY;
}
