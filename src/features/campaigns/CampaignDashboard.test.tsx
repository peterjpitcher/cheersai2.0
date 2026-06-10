/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCampaignDashboard } from '@/lib/campaigns/dashboard';
import { EMPTY_FOOD_BOOKING_INSIGHTS, type FoodBookingInsights } from '@/lib/campaigns/food-booking-insights';
import type { Campaign, CampaignPerformanceMetrics } from '@/types/campaigns';
import { CampaignDashboard } from './CampaignDashboard';

const { foodBookingFlag } = vi.hoisted(() => ({ foodBookingFlag: { value: true } }));

vi.mock('@/env', () => ({
  env: { server: {}, client: {} },
  featureFlags: {
    get foodBooking() {
      return foodBookingFlag.value;
    },
  },
}));

vi.mock('@/app/(app)/campaigns/actions', () => ({
  applyOptimisationRecommendationFormAction: vi.fn(),
  runOptimiserFormAction: vi.fn(),
  syncPerformanceFormAction: vi.fn(),
}));

vi.mock('./DeleteCampaignButton', () => ({
  DeleteCampaignButton: () => null,
}));

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

function campaign(overrides: Partial<Campaign>): Campaign {
  return {
    id: overrides.id ?? 'campaign-1',
    accountId: 'account-1',
    metaCampaignId: 'meta-1',
    name: overrides.name ?? 'Campaign',
    objective: 'OUTCOME_TRAFFIC',
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
  performance: EMPTY_PERFORMANCE,
    lastSyncedAt: new Date('2026-05-23T09:00:00Z'),
    campaignType: null,
    autoConfirm: false,
    createdAt: new Date('2026-05-01T09:00:00Z'),
    adSets: [],
    ...overrides,
  };
}

describe('CampaignDashboard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('puts the scoreboard directly after the stat cards and keeps finished campaigns behind a toggle', () => {
    const dashboard = buildCampaignDashboard(
      [
        campaign({ id: 'active', name: 'Active campaign' }),
        campaign({
          id: 'finished',
          name: 'Finished campaign',
          endDate: '2026-05-22',
        }),
      ],
      [],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z') },
    );

    const { container } = render(<CampaignDashboard dashboard={dashboard} />);
    const pageText = container.textContent ?? '';

    expect(pageText.indexOf('Campaign health')).toBeGreaterThan(-1);
    expect(pageText.indexOf('Campaign scoreboard')).toBeGreaterThan(pageText.indexOf('Campaign health'));
    expect(pageText.indexOf('Next action')).toBeGreaterThan(pageText.indexOf('Campaign scoreboard'));
    expect(screen.getAllByText('Active campaign').length).toBeGreaterThan(0);
    expect(screen.queryByText('Finished campaign')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show finished (1)' }));

    expect(screen.getAllByText('Finished campaign').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Hide finished' })).toBeTruthy();
  });

  it('renders advisory cutoff recommendations in the food booking panel', () => {
    const foodBookingInsights: FoodBookingInsights = {
      ...EMPTY_FOOD_BOOKING_INSIGHTS,
      totalBookings90d: 100,
      cutoffRecommendations: [
        {
          serviceKey: 'sunday_roast',
          decisionStage: 'last_tables',
          severity: 'info',
          message: 'Sunday roast “last tables” converts 2% of its bookings — consider dropping this window.',
        },
      ],
    };
    const dashboard = buildCampaignDashboard(
      [campaign({ id: 'food', name: 'Food campaign', campaignKind: 'food_booking' })],
      [],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z'), foodBookingInsights },
    );

    render(<CampaignDashboard dashboard={dashboard} />);

    expect(screen.getByText('Cutoff advice')).toBeTruthy();
    expect(
      screen.getByText(/Sunday roast “last tables” converts 2% of its bookings/),
    ).toBeTruthy();
  });

  it('renders no cutoff advice when there are no recommendations', () => {
    const foodBookingInsights: FoodBookingInsights = {
      ...EMPTY_FOOD_BOOKING_INSIGHTS,
      totalBookings90d: 100,
      cutoffRecommendations: [],
    };
    const dashboard = buildCampaignDashboard(
      [campaign({ id: 'food', name: 'Food campaign', campaignKind: 'food_booking' })],
      [],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z'), foodBookingInsights },
    );

    render(<CampaignDashboard dashboard={dashboard} />);

    expect(screen.queryByText('Cutoff advice')).toBeNull();
  });
});
