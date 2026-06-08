import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Task 4.1 — Meta client: campaign-level budget (CBO)
// These tests stub global.fetch directly, mirroring tests/lib/meta/marketing.test.ts.
// ---------------------------------------------------------------------------

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

import { createMetaCampaign } from '@/lib/meta/marketing';

describe('createMetaCampaign — campaign-level CBO budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  function bodyOfLastFetch(): URLSearchParams {
    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    return new URLSearchParams(init?.body as string);
  }

  it('enables ad set budget sharing and a lifetime_budget in minor units when CBO is requested', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'token',
      adAccountId: 'act_123',
      name: 'Food Booking',
      objective: 'OUTCOME_SALES',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
      useCampaignBudgetOptimization: true,
      lifetimeBudget: 200,
    });

    const body = bodyOfLastFetch();
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('true');
    expect(body.get('lifetime_budget')).toBe('20000');
    expect(body.get('daily_budget')).toBeNull();
  });

  it('enables ad set budget sharing and a daily_budget in minor units when CBO requests a daily budget', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'token',
      adAccountId: 'act_123',
      name: 'Food Booking',
      objective: 'OUTCOME_SALES',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
      useCampaignBudgetOptimization: true,
      dailyBudget: 35.5,
    });

    const body = bodyOfLastFetch();
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('true');
    expect(body.get('daily_budget')).toBe('3550');
    expect(body.get('lifetime_budget')).toBeNull();
  });

  it('leaves behaviour byte-for-byte unchanged when CBO is not requested', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'token',
      adAccountId: 'act_123',
      name: 'Event',
      objective: 'OUTCOME_SALES',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
    });

    const body = bodyOfLastFetch();
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('false');
    expect(body.get('lifetime_budget')).toBeNull();
    expect(body.get('daily_budget')).toBeNull();
  });

  it('does not set a campaign budget when a budget is supplied without the CBO flag', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'token',
      adAccountId: 'act_123',
      name: 'Event',
      objective: 'OUTCOME_SALES',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
      lifetimeBudget: 200,
    });

    const body = bodyOfLastFetch();
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('false');
    expect(body.get('lifetime_budget')).toBeNull();
    expect(body.get('daily_budget')).toBeNull();
  });
});
