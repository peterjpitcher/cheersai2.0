import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

import { createMetaCampaign, createMetaAdSet, MetaApiError } from '@/lib/meta/marketing';

describe('createMetaCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should POST to campaigns endpoint and return id', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    const result = await createMetaCampaign({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      name: 'Test Campaign',
      objective: 'OUTCOME_LEADS',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
    });

    expect(result.id).toBe('campaign_123');
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/campaigns'),
      expect.objectContaining({ method: 'POST' })
    );
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('special_ad_categories')).toBe('[]');
  });

  it('sends special ad categories as an array when a category is selected', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      name: 'Test Campaign',
      objective: 'OUTCOME_LEADS',
      specialAdCategory: 'CREDIT',
      status: 'PAUSED',
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('special_ad_categories')).toBe('["CREDIT"]');
  });

  it('should throw MetaApiError on API failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token', code: 190 } }),
    } as Response);

    await expect(
      createMetaCampaign({
        accessToken: 'bad-token',
        adAccountId: 'act_123',
        name: 'Test',
        objective: 'OUTCOME_LEADS',
        specialAdCategory: 'NONE',
        status: 'PAUSED',
      })
    ).rejects.toThrow('Invalid token');
  });

  it('should throw MetaApiError with correct code', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token', code: 190 } }),
    } as Response);

    try {
      await createMetaCampaign({
        accessToken: 'bad-token',
        adAccountId: 'act_123',
        name: 'Test',
        objective: 'OUTCOME_LEADS',
        specialAdCategory: 'NONE',
        status: 'PAUSED',
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MetaApiError);
      expect((err as MetaApiError).code).toBe(190);
    }
  });
});

describe('createMetaAdSet', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should POST to adsets endpoint and return id', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'adset_123' }),
    } as Response);

    const result = await createMetaAdSet({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      campaignId: 'campaign_123',
      name: 'Test Ad Set',
      targeting: { age_min: 25, age_max: 45, geo_locations: { countries: ['GB'] } },
      optimisationGoal: 'LEAD_GENERATION',
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      dailyBudget: 10,
      startTime: '2026-04-01T00:00:00Z',
      status: 'PAUSED',
    });

    expect(result.id).toBe('adset_123');
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/adsets'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
