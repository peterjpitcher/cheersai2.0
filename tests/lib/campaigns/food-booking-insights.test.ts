import { describe, expect, it } from 'vitest';

import {
  buildFoodBookingInsights,
  type FoodBookingConversionEventRow,
} from '@/lib/campaigns/food-booking-insights';
import type {
  Ad,
  AdSet,
  Campaign,
  CampaignPerformanceMetrics,
  FoodDecisionStage,
  FoodServiceKey,
} from '@/types/campaigns';

const EMPTY_PERFORMANCE: CampaignPerformanceMetrics = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  ctr: 0,
  cpc: 0,
  conversions: 0,
  costPerConversion: 0,
  conversionRate: 0,
};

function row(overrides: Partial<FoodBookingConversionEventRow>): FoodBookingConversionEventRow {
  return {
    booking_id: 'booking',
    booking_type: 'table',
    food_intent: null,
    utm_content: null,
    value: 0,
    currency: 'GBP',
    occurred_at: '2026-06-01T12:00:00.000Z',
    ...overrides,
  };
}

function ad(overrides: Partial<Ad>): Ad {
  return {
    id: overrides.id ?? 'ad-1',
    adsetId: overrides.adsetId ?? 'adset-1',
    metaAdId: null,
    metaCreativeId: null,
    name: overrides.name ?? 'Food ad',
    headline: 'Book a table',
    primaryText: 'Book a table for food.',
    description: 'Book now',
    cta: 'BOOK_NOW',
    angle: null,
    creativeFormat: 'venue_photo',
    creativeVariantKey: null,
    utmContentKey: overrides.utmContentKey ?? 'sunday_roast_morning-2026-06-14-venue-1',
    mediaAssetId: null,
    creativeBrief: null,
    previewUrl: null,
    metaStatus: null,
    performance: EMPTY_PERFORMANCE,
    lastSyncedAt: null,
    status: 'DRAFT',
    createdAt: new Date('2026-06-01T09:00:00Z'),
    ...overrides,
  };
}

function adSet(overrides: Partial<AdSet> & {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
}): AdSet {
  const id = overrides.id ?? 'adset-1';

  return {
    ...overrides,
    id,
    campaignId: 'campaign-1',
    metaAdsetId: null,
    name: overrides.name ?? 'Food window',
    phaseLabel: null,
    phaseStart: '2026-06-14',
    phaseEnd: '2026-06-14',
    targeting: {
      age_min: 18,
      age_max: 65,
      geo_locations: { countries: ['GB'] },
    },
    placements: 'AUTO',
    budgetAmount: null,
    optimisationGoal: 'OFFSITE_CONVERSIONS',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    adsetMediaAssetId: null,
    adsetImageUrl: null,
    adsStopTime: null,
    adsStartTime: null,
    serviceKey: overrides.serviceKey,
    decisionStage: overrides.decisionStage,
    budgetWeight: 30,
    metaStatus: null,
    performance: {
      ...EMPTY_PERFORMANCE,
      spend: overrides.performance?.spend ?? 0,
    },
    lastSyncedAt: null,
    status: 'DRAFT',
    createdAt: new Date('2026-06-01T09:00:00Z'),
    ads: overrides.ads ?? [ad({ adsetId: id })],
  };
}

function campaign(adSets: AdSet[]): Campaign {
  return {
    id: 'campaign-1',
    accountId: 'account-1',
    metaCampaignId: null,
    name: 'Food bookings',
    objective: 'OUTCOME_SALES',
    problemBrief: 'Food bookings',
    aiRationale: null,
    budgetType: 'DAILY',
    budgetAmount: 20,
    startDate: '2026-06-01',
    endDate: null,
    status: 'DRAFT',
    metaStatus: null,
    publishError: null,
    specialAdCategory: 'NONE',
    campaignKind: 'food_booking',
    sourceType: 'food_booking',
    sourceId: null,
    destinationUrl: 'https://www.the-anchor.pub/book',
    geoRadiusMiles: 3,
    audienceMode: 'local_only',
    audienceInterestKeywords: [],
    resolvedInterests: [],
    sourceSnapshot: null,
    qualityScore: null,
    qualityStatus: null,
    qualityIssues: [],
    audienceStrategy: null,
    performance: EMPTY_PERFORMANCE,
    lastSyncedAt: null,
    campaignType: null,
    autoConfirm: false,
    createdAt: new Date('2026-06-01T09:00:00Z'),
    adSets,
  };
}

describe('food booking insights', () => {
  it('attributes table bookings to service, decision stage, and window from ad UTM keys', () => {
    const sundayAdKey = 'sunday_roast_morning-2026-06-14-venue-1';
    const saturdayAdKey = 'saturday_lunch_commit-2026-06-13-people-1';
    const insights = buildFoodBookingInsights(
      [
        row({
          booking_id: 'sunday-1',
          utm_content: sundayAdKey.toUpperCase(),
          value: '60',
          occurred_at: '2026-06-14T09:00:00.000Z',
        }),
        row({
          booking_id: 'saturday-1',
          utm_content: saturdayAdKey,
          value: 35,
          occurred_at: '2026-06-13T09:00:00.000Z',
        }),
        row({
          booking_id: 'event-ignored',
          booking_type: 'event',
          utm_content: sundayAdKey,
          value: 100,
          occurred_at: '2026-06-14T09:00:00.000Z',
        }),
        row({
          booking_id: 'old',
          utm_content: saturdayAdKey,
          occurred_at: '2026-01-01T09:00:00.000Z',
        }),
      ],
      [
        campaign([
          adSet({
            id: 'sunday-adset',
            serviceKey: 'sunday_roast',
            decisionStage: 'morning_commit',
            performance: { ...EMPTY_PERFORMANCE, spend: 30 },
            ads: [ad({ id: 'sunday-ad', adsetId: 'sunday-adset', utmContentKey: sundayAdKey })],
          }),
          adSet({
            id: 'saturday-adset',
            serviceKey: 'saturday_food',
            decisionStage: 'lunch_decision',
            performance: { ...EMPTY_PERFORMANCE, spend: 20 },
            ads: [ad({ id: 'saturday-ad', adsetId: 'saturday-adset', utmContentKey: saturdayAdKey })],
          }),
        ]),
      ],
      new Date('2026-06-15T12:00:00.000Z'),
    );

    expect(insights.totalBookings30d).toBe(2);
    expect(insights.totalBookings90d).toBe(2);
    expect(insights.totalValue90d).toBe(95);
    expect(insights.costPerTableBooking).toBe(25);
    expect(insights.sundayRoastBookings90d).toBe(1);
    expect(insights.sundayRoastValue90d).toBe(60);
    expect(insights.topServices90d).toContainEqual(expect.objectContaining({
      key: 'saturday_food',
      bookings: 1,
      costPerBooking: 20,
    }));
    expect(insights.topServices90d).toContainEqual(expect.objectContaining({
      key: 'sunday_roast',
      bookings: 1,
      costPerBooking: 30,
    }));
    expect(insights.topDecisionStages90d).toContainEqual(expect.objectContaining({
      key: 'lunch_decision',
      bookings: 1,
    }));
    expect(insights.topDecisionStages90d).toContainEqual(expect.objectContaining({
      key: 'morning_commit',
      bookings: 1,
    }));
    expect(insights.topWindows90d).toContainEqual(expect.objectContaining({
      key: 'sunday_roast_morning',
      name: 'Sunday Roast Morning',
      bookings: 1,
    }));
  });

  it('falls back to food_intent and exposes unattributed table bookings', () => {
    const insights = buildFoodBookingInsights(
      [
        row({
          booking_id: 'roast-fallback',
          food_intent: 'sunday_roast',
          value: 40,
        }),
        row({
          booking_id: 'unattributed',
          food_intent: 'planning_to_eat',
          value: 20,
        }),
      ],
      [],
      new Date('2026-06-15T12:00:00.000Z'),
    );

    expect(insights.totalBookings90d).toBe(2);
    expect(insights.topServices90d).toContainEqual(expect.objectContaining({
      key: 'sunday_roast',
      bookings: 1,
    }));
    expect(insights.topServices90d).toContainEqual(expect.objectContaining({
      key: 'unattributed',
      bookings: 1,
    }));
    expect(insights.topWindows90d).toEqual([
      expect.objectContaining({
        key: 'unattributed',
        bookings: 2,
      }),
    ]);
  });

  it('separates 30-day from 90-day totals', () => {
    const insights = buildFoodBookingInsights(
      [
        row({ booking_id: 'recent', value: 30, occurred_at: '2026-06-10T12:00:00.000Z' }),
        row({ booking_id: 'mid-window', value: 20, occurred_at: '2026-04-20T12:00:00.000Z' }),
        row({ booking_id: 'too-old', value: 99, occurred_at: '2026-01-01T12:00:00.000Z' }),
      ],
      [],
      new Date('2026-06-15T12:00:00.000Z'),
    );

    // 'recent' is within 30d; 'mid-window' is within 90d but outside 30d; 'too-old' is excluded.
    expect(insights.totalBookings30d).toBe(1);
    expect(insights.totalBookings90d).toBe(2);
    expect(insights.totalValue90d).toBe(50);
  });

  it('returns null cost per table booking when there are bookings but no food spend', () => {
    const sundayAdKey = 'sunday_roast_morning-2026-06-14-venue-1';
    const insights = buildFoodBookingInsights(
      [row({ booking_id: 'sunday-1', utm_content: sundayAdKey, value: 60 })],
      [
        campaign([
          adSet({
            id: 'sunday-adset',
            serviceKey: 'sunday_roast',
            decisionStage: 'morning_commit',
            performance: { ...EMPTY_PERFORMANCE, spend: 0 },
            ads: [ad({ id: 'sunday-ad', adsetId: 'sunday-adset', utmContentKey: sundayAdKey })],
          }),
        ]),
      ],
      new Date('2026-06-15T12:00:00.000Z'),
    );

    expect(insights.totalBookings90d).toBe(1);
    expect(insights.costPerTableBooking).toBeNull();
    expect(insights.topServices90d).toContainEqual(expect.objectContaining({
      key: 'sunday_roast',
      bookings: 1,
      costPerBooking: null,
    }));
  });

  it('returns empty insight totals when there are no table bookings', () => {
    const insights = buildFoodBookingInsights([], [], new Date('2026-06-15T12:00:00.000Z'));

    expect(insights).toMatchObject({
      totalBookings30d: 0,
      totalBookings90d: 0,
      totalValue90d: 0,
      costPerTableBooking: null,
      sundayRoastBookings90d: 0,
      topServices90d: [],
    });
  });
});
