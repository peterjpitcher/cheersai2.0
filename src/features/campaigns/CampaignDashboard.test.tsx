/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCampaignDashboard } from '@/lib/campaigns/dashboard';
import { EMPTY_FOOD_BOOKING_INSIGHTS, type FoodBookingInsights } from '@/lib/campaigns/food-booking-insights';
import type { Campaign, CampaignPerformanceMetrics, OptimisationActionSummary } from '@/types/campaigns';
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
  activateOptimisationReplacementAd: vi.fn(),
  applyOptimisationRecommendation: vi.fn(),
  runCampaignDashboardOptimisation: vi.fn(),
  syncCampaignDashboardPerformance: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock('./DeleteCampaignButton', () => ({
  DeleteCampaignButton: () => null,
}));

const EMPTY_PERFORMANCE: CampaignPerformanceMetrics = {
  spend: 0,
  impressions: 0,
  reach: 0,
  reactions: 0,
  comments: 0,
  shares: 0,
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

  it('shows campaign clicks in the scoreboard', () => {
    const dashboard = buildCampaignDashboard(
      [
        campaign({
          id: 'clicked',
          name: 'Clicked campaign',
          performance: { ...EMPTY_PERFORMANCE, clicks: 1234 },
        }),
      ],
      [],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z') },
    );

    render(<CampaignDashboard dashboard={dashboard} />);

    expect(screen.getByRole('columnheader', { name: 'Clicks' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '1,234' })).toBeTruthy();
  });

  it('shows reach and the engagement breakdown beside clicks', () => {
    const dashboard = buildCampaignDashboard(
      [
        campaign({
          id: 'impact',
          name: 'Impact campaign',
          performance: {
            ...EMPTY_PERFORMANCE,
            reach: 950,
            reactions: 48,
            comments: 6,
            shares: 3,
            clicks: 32,
          },
        }),
      ],
      [],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z') },
    );

    render(<CampaignDashboard dashboard={dashboard} />);

    expect(
      within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Campaign',
      'Status',
      'Reach',
      'Engagement',
      'Clicks',
      'CTR',
      'Bookings',
      'Cost/booking',
      'Spend',
      'Last sync',
      'Actions',
    ]);

    const row = screen.getByRole('row', { name: /Impact campaign/ });
    expect(within(row).getByRole('cell', { name: '950' })).toBeTruthy();
    expect(within(row).getByText('57')).toBeTruthy();
    expect(within(row).getByText('48 reactions · 6 comments · 3 shares')).toBeTruthy();
    expect(within(row).getByRole('cell', { name: '32' })).toBeTruthy();
  });

  it('shows explicit zero engagement instead of missing data', () => {
    const dashboard = buildCampaignDashboard(
      [campaign({ id: 'no-engagement', name: 'No engagement campaign' })],
      [],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z') },
    );

    render(<CampaignDashboard dashboard={dashboard} />);

    const row = screen.getByRole('row', { name: /No engagement campaign/ });
    const engagementCell = within(row).getByRole('cell', {
      name: '0 0 reactions · 0 comments · 0 shares',
    });

    expect(within(engagementCell).getByText('0')).toBeTruthy();
    expect(within(engagementCell).getByText('0 reactions · 0 comments · 0 shares')).toBeTruthy();
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

  it('shows why a blocked rewrite cannot be applied and offers the paused flow for safe ones', () => {
    const baseAction: OptimisationActionSummary = {
      id: 'blocked',
      runId: 'run-1',
      campaignId: 'active',
      campaignName: 'Weekday Lunch A (cod and chips)',
      adSetId: 'adset-1',
      adSetName: 'Ad set',
      adId: 'ad-1',
      adName: 'Var 1',
      actionType: 'copy_rewrite',
      reason: 'Rewrite recommended.',
      status: 'planned',
      severity: 'info',
      error: null,
      metricsSnapshot: {},
      recommendationPayload: {
        proposed: { headline: 'Book Weekday Lunch A (cod and chips)', primaryText: 'Reserve a table.', description: 'Book now', cta: 'BOOK_NOW' },
      },
      copyProblems: ['it uses the internal campaign name'],
      replacementAdId: null,
      appliedAt: null,
      createdAt: new Date('2026-05-22T09:00:00Z'),
    };
    const dashboard = buildCampaignDashboard(
      [campaign({ id: 'active', name: 'Weekday Lunch A (cod and chips)' })],
      [
        baseAction,
        {
          ...baseAction,
          id: 'safe',
          recommendationPayload: {
            proposed: { headline: 'Lunch from £9, Tuesday to Friday', primaryText: 'Snack pots are £9.', description: 'Book now', cta: 'BOOK_NOW' },
          },
          copyProblems: [],
        },
      ],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z') },
    );

    render(<CampaignDashboard dashboard={dashboard} />);

    expect(screen.getByText('Cannot be applied: it uses the internal campaign name.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Create paused replacement' })).toHaveLength(1);
    expect(screen.getByText('1 recommendation waiting for approval')).toBeTruthy();
  });

  it('offers to switch on a replacement ad that was created paused', () => {
    const dashboard = buildCampaignDashboard(
      [campaign({ id: 'active', name: 'Active campaign' })],
      [{
        id: 'applied',
        runId: 'run-1',
        campaignId: 'active',
        campaignName: 'Active campaign',
        adSetId: 'adset-1',
        adSetName: 'Ad set',
        adId: 'ad-1',
        adName: 'Var 2',
        actionType: 'copy_rewrite',
        reason: 'Rewrite recommended.',
        status: 'applied',
        severity: 'info',
        error: null,
        metricsSnapshot: {},
        recommendationPayload: {
          proposed: { headline: 'Lunch from £9, Tuesday to Friday', primaryText: 'Snack pots are £9.', description: 'Book now', cta: 'BOOK_NOW' },
        },
        replacementAdId: 'replacement-1',
        replacementAdStatus: 'PAUSED',
        appliedAt: new Date('2026-05-22T10:00:00Z'),
        createdAt: new Date('2026-05-22T09:00:00Z'),
      }],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z') },
    );

    render(<CampaignDashboard dashboard={dashboard} />);

    expect(screen.getByText('Replacement ad created paused. Check it, then switch it on.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch on replacement ad' })).toBeTruthy();
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
