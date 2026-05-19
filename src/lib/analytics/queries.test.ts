/**
 * Tests for analytics query functions.
 * Mocks Supabase service client to test data fetching and shaping logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DateRange } from './types';

// ---------------------------------------------------------------------------
// Mock Supabase service client
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockLte = vi.fn();
const mockReturns = vi.fn();
const mockOrder = vi.fn();

function buildChain() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    gte: mockGte,
    lte: mockLte,
    returns: mockReturns,
    order: mockOrder,
  };
  // Each method returns the chain for fluent API
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockGte.mockReturnValue(chain);
  mockLte.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  return chain;
}

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
  tryCreateServiceSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Import after mocks
import {
  getPostAnalytics,
  getEngagementByPlatform,
  getEngagementByContentType,
  getGbpDailyMetrics,
} from './queries';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acc-001';
const DATE_RANGE: DateRange = { start: '2026-05-01', end: '2026-05-31' };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getPostAnalytics
// ---------------------------------------------------------------------------

describe('getPostAnalytics', () => {
  it('should query analytics_snapshots and return shaped PostAnalytics[]', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    mockReturns.mockResolvedValue({
      data: [
        {
          publish_job_id: 'job-1',
          platform: 'facebook',
          impressions: 1000,
          reach: 800,
          engagement_count: 50,
          engagement_rate: 0.05,
          clicks: 20,
          shares: 10,
          comments: 5,
          snapshot_date: '2026-05-10',
          publish_jobs: {
            content_item_id: 'ci-1',
            scheduled_for: '2026-05-10T12:00:00Z',
            content_items: {
              content_type: 'instant_post',
            },
          },
        },
      ],
      error: null,
    });

    const result = await getPostAnalytics(ACCOUNT_ID, DATE_RANGE);

    expect(mockFrom).toHaveBeenCalledWith('analytics_snapshots');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      publishJobId: 'job-1',
      platform: 'facebook',
      impressions: 1000,
      engagementCount: 50,
      contentType: 'instant_post',
    });
  });

  it('should return empty array on query error', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    mockReturns.mockResolvedValue({
      data: null,
      error: { message: 'Some error' },
    });

    const result = await getPostAnalytics(ACCOUNT_ID, DATE_RANGE);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getEngagementByPlatform
// ---------------------------------------------------------------------------

describe('getEngagementByPlatform', () => {
  it('should fetch post analytics and aggregate by platform', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    mockReturns.mockResolvedValue({
      data: [
        {
          publish_job_id: 'job-1',
          platform: 'facebook',
          impressions: 1000,
          reach: 800,
          engagement_count: 50,
          engagement_rate: 0.05,
          clicks: 20,
          shares: 10,
          comments: 5,
          snapshot_date: '2026-05-10',
          publish_jobs: {
            content_item_id: 'ci-1',
            scheduled_for: '2026-05-10T12:00:00Z',
            content_items: { content_type: 'instant_post' },
          },
        },
      ],
      error: null,
    });

    const result = await getEngagementByPlatform(ACCOUNT_ID, DATE_RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('facebook');
  });
});

// ---------------------------------------------------------------------------
// getEngagementByContentType
// ---------------------------------------------------------------------------

describe('getEngagementByContentType', () => {
  it('should fetch post analytics and aggregate by content type', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    mockReturns.mockResolvedValue({
      data: [
        {
          publish_job_id: 'job-1',
          platform: 'instagram',
          impressions: 500,
          reach: 400,
          engagement_count: 75,
          engagement_rate: 0.15,
          clicks: 30,
          shares: 20,
          comments: 15,
          snapshot_date: '2026-05-12',
          publish_jobs: {
            content_item_id: 'ci-2',
            scheduled_for: '2026-05-12T14:00:00Z',
            content_items: { content_type: 'event' },
          },
        },
      ],
      error: null,
    });

    const result = await getEngagementByContentType(ACCOUNT_ID, DATE_RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].contentType).toBe('event');
  });
});

// ---------------------------------------------------------------------------
// getGbpDailyMetrics
// ---------------------------------------------------------------------------

describe('getGbpDailyMetrics', () => {
  it('should query gbp_daily_metrics and return shaped GbpLocationMetrics[]', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    mockReturns.mockResolvedValue({
      data: [
        {
          metric_date: '2026-05-10',
          search_views: 120,
          map_views: 45,
          website_clicks: 30,
          direction_requests: 8,
          phone_calls: 5,
        },
      ],
      error: null,
    });

    const result = await getGbpDailyMetrics(ACCOUNT_ID, DATE_RANGE);

    expect(mockFrom).toHaveBeenCalledWith('gbp_daily_metrics');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metricDate: '2026-05-10',
      searchViews: 120,
      mapViews: 45,
      websiteClicks: 30,
      directionRequests: 8,
      phoneCalls: 5,
    });
  });

  it('should return empty array on query error', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    mockReturns.mockResolvedValue({
      data: null,
      error: { message: 'Some error' },
    });

    const result = await getGbpDailyMetrics(ACCOUNT_ID, DATE_RANGE);
    expect(result).toEqual([]);
  });
});
