import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

import {
  createMetaCampaign,
  createMetaAdSet,
  MetaApiError,
  searchMetaInterests,
} from '@/lib/meta/marketing';

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
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('false');
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
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('false');
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

describe('searchMetaInterests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('searches Meta ad interests by keyword', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: '6003139266461',
            name: 'Pub quiz',
            path: ['Interests', 'Pub quiz'],
            description: 'People interested in pub quizzes',
            audience_size_lower_bound: 100000,
            audience_size_upper_bound: '200000',
          },
        ],
      }),
    } as Response);

    const result = await searchMetaInterests('test-token', 'pub quiz', { limit: 5 });

    expect(result).toEqual([
      {
        id: '6003139266461',
        name: 'Pub quiz',
        path: ['Interests', 'Pub quiz'],
        description: 'People interested in pub quizzes',
        audience_size: null,
        audience_size_lower_bound: 100000,
        audience_size_upper_bound: 200000,
      },
    ]);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/search?'),
      expect.objectContaining({ method: 'GET' }),
    );
    const [url] = vi.mocked(global.fetch).mock.calls[0];
    const params = new URL(String(url)).searchParams;
    expect(params.get('type')).toBe('adinterest');
    expect(params.get('q')).toBe('pub quiz');
    expect(params.get('limit')).toBe('5');
  });

  it('returns an empty list for empty interest queries', async () => {
    const result = await searchMetaInterests('test-token', '   ');

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws MetaApiError on interest search failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Bad query', code: 100 } }),
    } as Response);

    await expect(searchMetaInterests('test-token', 'pub quiz')).rejects.toThrow('Bad query');
  });
});
