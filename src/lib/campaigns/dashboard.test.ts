import { describe, expect, it } from 'vitest';

import { applyFirstPartyBookingCount } from '@/lib/campaigns/dashboard';
import type { Campaign, CampaignPerformanceMetrics } from '@/types/campaigns';

function perf(overrides: Partial<CampaignPerformanceMetrics> = {}): CampaignPerformanceMetrics {
  return {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    conversions: 0,
    costPerConversion: 0,
    conversionRate: 0,
    ...overrides,
  };
}

function campaign(performance: CampaignPerformanceMetrics): Campaign {
  return {
    id: 'campaign-1',
    accountId: 'account-1',
    metaCampaignId: 'meta-1',
    name: 'Campaign',
    objective: 'OUTCOME_SALES',
    problemBrief: 'Brief',
    aiRationale: null,
    budgetType: 'DAILY',
    budgetAmount: 20,
    startDate: '2026-05-01',
    endDate: null,
    status: 'ACTIVE',
    metaStatus: 'ACTIVE',
    publishError: null,
    specialAdCategory: 'NONE',
    campaignKind: 'event',
    sourceType: null,
    sourceId: null,
    destinationUrl: null,
    geoRadiusMiles: 3,
    audienceMode: 'local_only',
    audienceInterestKeywords: [],
    resolvedInterests: [],
    sourceSnapshot: null,
    qualityScore: null,
    qualityStatus: null,
    qualityIssues: [],
    audienceStrategy: null,
    performance,
    lastSyncedAt: new Date('2026-05-23T09:00:00Z'),
    campaignType: null,
    autoConfirm: false,
    createdAt: new Date('2026-05-01T09:00:00Z'),
    adSets: [],
  };
}

describe('applyFirstPartyBookingCount', () => {
  it('uses first-party bookings when Meta reports zero (the /campaigns vs /campaigns/[id] bug)', () => {
    // Reproduces the reported symptom: Meta Purchase conversions = 0 but one first-party booking
    // exists. The detail page (getCampaignWithTree) must show 1, matching the /campaigns list.
    const result = applyFirstPartyBookingCount(
      campaign(perf({ spend: 1.52, clicks: 3, conversions: 0 })),
      1,
      0,
    );

    expect(result.performance.metaConversions).toBe(0);
    expect(result.performance.firstPartyBookings).toBe(1);
    expect(result.performance.blendedBookings).toBe(1);
    expect(result.performance.conversions).toBe(1);
    expect(result.performance.costPerConversion).toBeCloseTo(1.52, 5);
    expect(result.performance.conversionRate).toBeCloseTo((1 / 3) * 100, 5);
  });

  it('keeps Meta conversions when they exceed first-party bookings (max, not sum)', () => {
    const result = applyFirstPartyBookingCount(
      campaign(perf({ spend: 40, clicks: 20, conversions: 8 })),
      3,
    );

    expect(result.performance.metaConversions).toBe(8);
    expect(result.performance.blendedBookings).toBe(8);
    expect(result.performance.conversions).toBe(8);
  });

  it('leaves Meta metrics unchanged when there are no first-party bookings', () => {
    const result = applyFirstPartyBookingCount(
      campaign(perf({ spend: 10, clicks: 5, conversions: 2 })),
      0,
    );

    expect(result.performance.blendedBookings).toBe(2);
    expect(result.performance.conversions).toBe(2);
    expect(result.performance.costPerConversion).toBeCloseTo(5, 5);
  });

  it('flows first-party booking value into blendedBookingValue', () => {
    const result = applyFirstPartyBookingCount(
      campaign(perf({ spend: 10, clicks: 5, conversions: 0 })),
      2,
      55,
    );

    expect(result.performance.firstPartyBookingValue).toBe(55);
    expect(result.performance.blendedBookingValue).toBe(55);
  });

  it('clamps conversion rate to 100% when bookings exceed clicks', () => {
    // 10 first-party bookings / 2 paid clicks would be 500% uncapped — a booking need not
    // follow a paid click, so the displayed rate is clamped to a sensible 100%.
    const result = applyFirstPartyBookingCount(
      campaign(perf({ spend: 10, clicks: 2, conversions: 0 })),
      10,
    );

    expect(result.performance.conversionRate).toBe(100);
  });

  it('preserves the nested ad-set tree by reference so the detail page can still render it', () => {
    const base = campaign(perf({ conversions: 0 }));
    const result = applyFirstPartyBookingCount(base, 4);

    expect(result.adSets).toBe(base.adSets);
  });
});
