import { describe, expect, it } from 'vitest';

import {
  getPerformanceTone,
  hasRankableAdPerformance,
  sortAdsByPerformance,
} from '@/lib/campaigns/performance-matrix';
import type { CampaignPerformanceMetrics } from '@/types/campaigns';

function performance(overrides: Partial<CampaignPerformanceMetrics>): CampaignPerformanceMetrics {
  return {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    ...overrides,
  };
}

function ad(id: string, metrics: Partial<CampaignPerformanceMetrics>) {
  return { id, performance: performance(metrics) };
}

describe('performance matrix helpers', () => {
  it('sorts ads by clicks, then lower cpc, higher ctr, and higher spend', () => {
    const sorted = sortAdsByPerformance([
      ad('low-clicks', { clicks: 3, cpc: 0.1, ctr: 8, spend: 10 }),
      ad('expensive', { clicks: 10, cpc: 0.8, ctr: 5, spend: 20 }),
      ad('cheap', { clicks: 10, cpc: 0.4, ctr: 4, spend: 10 }),
      ad('same-cpc-better-ctr', { clicks: 10, cpc: 0.4, ctr: 6, spend: 8 }),
      ad('same-ctr-more-spend', { clicks: 10, cpc: 0.4, ctr: 6, spend: 12 }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      'same-ctr-more-spend',
      'same-cpc-better-ctr',
      'cheap',
      'expensive',
      'low-clicks',
    ]);
  });

  it('keeps all-zero ads stable and does not mark them rankable', () => {
    const first = ad('first', {});
    const second = ad('second', {});

    expect(sortAdsByPerformance([first, second]).map((item) => item.id)).toEqual(['first', 'second']);
    expect(hasRankableAdPerformance(first)).toBe(false);
  });

  it('treats the highest click and ctr values as best', () => {
    const context = [
      performance({ clicks: 3, ctr: 1.2 }),
      performance({ clicks: 10, ctr: 4.5 }),
      performance({ clicks: 1, ctr: 0.3 }),
    ];

    expect(getPerformanceTone('clicks', 10, context)).toBe('best');
    expect(getPerformanceTone('clicks', 1, context)).toBe('weak');
    expect(getPerformanceTone('ctr', 4.5, context)).toBe('best');
    expect(getPerformanceTone('ctr', 0, context)).toBe('neutral');
  });

  it('treats lower positive cpc as best and zero cpc as neutral', () => {
    const context = [
      performance({ cpc: 0.3 }),
      performance({ cpc: 0.9 }),
      performance({ cpc: 0 }),
    ];

    expect(getPerformanceTone('cpc', 0.3, context)).toBe('best');
    expect(getPerformanceTone('cpc', 0.9, context)).toBe('weak');
    expect(getPerformanceTone('cpc', 0, context)).toBe('neutral');
  });
});
