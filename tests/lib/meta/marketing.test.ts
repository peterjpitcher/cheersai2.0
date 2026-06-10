import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

import {
  createMetaAdCreative,
  createMetaCampaign,
  createMetaAdSet,
  fetchMetaObjectInsights,
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

  it('enables ad set budget sharing and a lifetime_budget in minor units when CBO is requested', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      name: 'Food Booking',
      objective: 'OUTCOME_SALES',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
      useCampaignBudgetOptimization: true,
      lifetimeBudget: 200,
      endTime: '2026-06-15T23:00:00.000Z',
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('true');
    expect(body.get('lifetime_budget')).toBe('20000');
    expect(body.get('daily_budget')).toBeNull();
    // Meta requires a campaign end_time alongside a lifetime budget.
    expect(body.get('end_time')).toBe('2026-06-15T23:00:00.000Z');
  });

  it('throws when a CBO lifetime budget is requested without a campaign end_time', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await expect(
      createMetaCampaign({
        accessToken: 'test-token',
        adAccountId: 'act_123',
        name: 'Food Booking',
        objective: 'OUTCOME_SALES',
        specialAdCategory: 'NONE',
        status: 'PAUSED',
        useCampaignBudgetOptimization: true,
        lifetimeBudget: 200,
      }),
    ).rejects.toThrow(MetaApiError);
    // The request must not be sent if it would be rejected by Meta.
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it('enables ad set budget sharing and a daily_budget in minor units for a CBO daily budget', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      name: 'Food Booking',
      objective: 'OUTCOME_SALES',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
      useCampaignBudgetOptimization: true,
      dailyBudget: 35.5,
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('true');
    expect(body.get('daily_budget')).toBe('3550');
    expect(body.get('lifetime_budget')).toBeNull();
    // A daily budget never carries a campaign end_time.
    expect(body.get('end_time')).toBeNull();
  });

  it('does not set a campaign budget when a budget is supplied without the CBO flag', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    await createMetaCampaign({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      name: 'Event',
      objective: 'OUTCOME_SALES',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
      lifetimeBudget: 200,
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('is_adset_budget_sharing_enabled')).toBe('false');
    expect(body.get('lifetime_budget')).toBeNull();
    expect(body.get('daily_budget')).toBeNull();
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
      promotedObject: { pixel_id: '757659911002159', custom_event_type: 'PURCHASE' },
    });

    expect(result.id).toBe('adset_123');
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/adsets'),
      expect.objectContaining({ method: 'POST' })
    );
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('promoted_object')).toBe(JSON.stringify({
      pixel_id: '757659911002159',
      custom_event_type: 'PURCHASE',
    }));
  });

  it('emits min_budget/max_budget in minor units only when the parent campaign uses CBO', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'adset_caps' }),
    } as Response);

    await createMetaAdSet({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      campaignId: 'campaign_123',
      name: 'Food window',
      targeting: { geo_locations: { countries: ['GB'] } },
      optimisationGoal: 'OFFSITE_CONVERSIONS',
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      startTime: '2026-06-10T11:00:00Z',
      status: 'PAUSED',
      parentUsesCampaignBudgetOptimization: true,
      minBudget: 5,
      maxBudget: 15,
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('min_budget')).toBe('500');
    expect(body.get('max_budget')).toBe('1500');
    // CBO ad sets must not carry their own daily/lifetime budget.
    expect(body.has('daily_budget')).toBe(false);
    expect(body.has('lifetime_budget')).toBe(false);
  });

  it('does not emit min_budget/max_budget when the parent campaign does not use CBO', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'adset_no_caps' }),
    } as Response);

    await createMetaAdSet({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      campaignId: 'campaign_123',
      name: 'Standard ad set',
      targeting: { geo_locations: { countries: ['GB'] } },
      optimisationGoal: 'LEAD_GENERATION',
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      dailyBudget: 10,
      startTime: '2026-06-10T11:00:00Z',
      status: 'PAUSED',
      // Caps supplied but parent is not CBO => they must be ignored.
      minBudget: 5,
      maxBudget: 15,
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.has('min_budget')).toBe(false);
    expect(body.has('max_budget')).toBe(false);
    expect(body.get('daily_budget')).toBe('1000');
  });

  it('does not emit caps under CBO when minBudget/maxBudget are absent', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'adset_cbo_no_caps' }),
    } as Response);

    await createMetaAdSet({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      campaignId: 'campaign_123',
      name: 'Food window no caps',
      targeting: { geo_locations: { countries: ['GB'] } },
      optimisationGoal: 'OFFSITE_CONVERSIONS',
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      startTime: '2026-06-10T11:00:00Z',
      status: 'PAUSED',
      parentUsesCampaignBudgetOptimization: true,
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.has('min_budget')).toBe(false);
    expect(body.has('max_budget')).toBe(false);
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

describe('createMetaAdCreative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('sends Book Now as Meta Ads Manager compatible BOOK_TRAVEL', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'creative_123' }),
    } as Response);

    await createMetaAdCreative({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      name: 'Quiz Night',
      pageId: 'page_123',
      linkUrl: 'https://www.the-anchor.pub/events/quiz-night',
      imageHash: 'image_hash',
      message: 'Quiz night is coming.',
      headline: 'Book the quiz',
      description: 'Book your table.',
      callToActionType: 'BOOK_NOW',
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    const objectStorySpec = JSON.parse(body.get('object_story_spec') ?? '{}') as {
      link_data?: {
        call_to_action?: {
          type?: string;
          value?: { link?: string };
        };
      };
    };

    expect(objectStorySpec.link_data?.call_to_action).toEqual({
      type: 'BOOK_TRAVEL',
      value: { link: 'https://www.the-anchor.pub/events/quiz-night' },
    });
  });
});

describe('fetchMetaObjectInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('maps Meta insights and uses campaign date range when supplied', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            spend: '12.34',
            impressions: '1200',
            reach: '950',
            clicks: '40',
            inline_link_clicks: '32',
            ctr: '2.67',
            cpc: '0.39',
            actions: [
              { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
              { action_type: 'link_click', value: '32' },
            ],
            cost_per_action_type: [
              { action_type: 'offsite_conversion.fb_pixel_purchase', value: '6.17' },
            ],
          }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ACTIVE' }),
      } as Response);

    const result = await fetchMetaObjectInsights('object_123', 'token', {
      since: '2026-04-01',
      until: '2026-04-10',
    });

    expect(result).toEqual({
      spend: 12.34,
      impressions: 1200,
      reach: 950,
      clicks: 32,
      ctr: 2.67,
      cpc: 0.39,
      conversions: 2,
      costPerConversion: 6.17,
      conversionRate: 6.25,
      status: 'ACTIVE',
    });

    const [insightsUrl] = vi.mocked(global.fetch).mock.calls[0];
    const params = new URL(String(insightsUrl)).searchParams;
    expect(params.get('fields')).toBe('spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,actions,cost_per_action_type');
    expect(JSON.parse(params.get('time_range') ?? '{}')).toEqual({
      since: '2026-04-01',
      until: '2026-04-10',
    });
    expect(params.get('date_preset')).toBeNull();
  });
});
