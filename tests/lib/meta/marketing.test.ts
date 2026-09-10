import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

import {
  createMetaAdCreative,
  createMetaCampaign,
  createMetaAdSet,
  fetchMetaAdSetSchedule,
  fetchMetaObjectInsights,
  MetaApiError,
  searchMetaInterests,
  type CreateAdSetParams,
  type MetaAdSetScheduleEntry,
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

describe('createMetaAdSet delivery schedule (day parting)', () => {
  // Weekday lunch: Tuesday to Friday, 09:00 to 14:00 in ad account time.
  const LUNCH_SCHEDULE: MetaAdSetScheduleEntry[] = [
    { start_minute: 540, end_minute: 840, days: [2, 3, 4, 5], timezone_type: 'ADVERTISER' },
  ];

  const lifetimeAdSet: CreateAdSetParams = {
    accessToken: 'test-token',
    adAccountId: 'act_123',
    campaignId: 'campaign_123',
    name: 'Weekday Lunch',
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
    optimisationGoal: 'LINK_CLICKS',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    lifetimeBudget: 180,
    startTime: '2026-09-14T23:00:00.000Z',
    endTime: '2026-10-09T23:00:00.000Z',
    status: 'PAUSED',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'adset_123' }),
    } as Response);
  });

  it('sends pacing_type day_parting and the adset_schedule on a lifetime budget', async () => {
    await createMetaAdSet({ ...lifetimeAdSet, schedule: LUNCH_SCHEDULE });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('pacing_type')).toBe('["day_parting"]');
    expect(JSON.parse(body.get('adset_schedule') ?? 'null')).toEqual(LUNCH_SCHEDULE);
    expect(body.get('lifetime_budget')).toBe('18000');
    expect(body.get('end_time')).toBe('2026-10-09T23:00:00.000Z');
    expect(body.has('daily_budget')).toBe(false);
  });

  it('sends a byte-for-byte unchanged body when there is no schedule', async () => {
    await createMetaAdSet(lifetimeAdSet);

    // Exactly the fields, order and encoding the client sent before schedules existed.
    const expected = new URLSearchParams();
    expected.set('access_token', 'test-token');
    expected.set('name', 'Weekday Lunch');
    expected.set('campaign_id', 'campaign_123');
    expected.set('targeting', JSON.stringify({ age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } }));
    expected.set('optimization_goal', 'LINK_CLICKS');
    expected.set('billing_event', 'IMPRESSIONS');
    expected.set('bid_strategy', 'LOWEST_COST_WITHOUT_CAP');
    expected.set('start_time', '2026-09-14T23:00:00.000Z');
    expected.set('status', 'PAUSED');
    expected.set('lifetime_budget', '18000');
    expected.set('end_time', '2026-10-09T23:00:00.000Z');

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v24.0/act_123/adsets');
    expect(init?.body).toBe(expected.toString());

    // An explicit undefined schedule is the same as none.
    await createMetaAdSet({ ...lifetimeAdSet, schedule: undefined });
    expect(vi.mocked(global.fetch).mock.calls[1]?.[1]?.body).toBe(expected.toString());
  });

  it.each<[string, Partial<CreateAdSetParams>]>([
    ['a daily budget', { lifetimeBudget: undefined, dailyBudget: 10 }],
    ['both daily and lifetime budgets', { dailyBudget: 10 }],
    ['no lifetime budget', { lifetimeBudget: undefined }],
    ['campaign budget optimisation', { lifetimeBudget: undefined, parentUsesCampaignBudgetOptimization: true }],
    ['an empty schedule', { schedule: [] }],
  ])('throws before any request when the schedule comes with %s', async (_label, overrides) => {
    await expect(
      createMetaAdSet({ ...lifetimeAdSet, schedule: LUNCH_SCHEDULE, ...overrides }),
    ).rejects.toThrow(MetaApiError);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it('keeps the existing end date guard: a scheduled lifetime ad set without an end time is refused', async () => {
    await expect(
      createMetaAdSet({ ...lifetimeAdSet, endTime: undefined, schedule: LUNCH_SCHEDULE }),
    ).rejects.toThrow('Lifetime budget ad sets require an end date');
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

describe('fetchMetaAdSetSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('reads pacing_type and adset_schedule for the ad set', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'adset_123',
        pacing_type: ['day_parting'],
        adset_schedule: [{ start_minute: 540, end_minute: 840, days: [2, 3, 4, 5], timezone_type: 'ADVERTISER' }],
      }),
    } as Response);

    const result = await fetchMetaAdSetSchedule('adset_123', 'token');

    expect(result).toEqual({
      pacingType: ['day_parting'],
      adsetSchedule: [{ start_minute: 540, end_minute: 840, days: [2, 3, 4, 5], timezone_type: 'ADVERTISER' }],
    });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/v24.0/adset_123');
    expect(parsed.searchParams.get('fields')).toBe('pacing_type,adset_schedule');
    expect(init).toEqual(expect.objectContaining({ method: 'GET' }));
  });

  it('normalises numbers sent as text and a lower-case time zone type', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        pacing_type: ['day_parting'],
        adset_schedule: [{ start_minute: '540', end_minute: '840', days: ['2', 3], timezone_type: 'advertiser' }],
      }),
    } as Response);

    const result = await fetchMetaAdSetSchedule('adset_123', 'token');

    expect(result.adsetSchedule).toEqual([
      { start_minute: 540, end_minute: 840, days: [2, 3], timezone_type: 'ADVERTISER' },
    ]);
  });

  it('returns empty values when Meta omits the fields, so they can never match a schedule', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'adset_123', adset_schedule: [{ days: [2] }] }),
    } as Response);

    const result = await fetchMetaAdSetSchedule('adset_123', 'token');

    expect(result.pacingType).toEqual([]);
    expect(result.adsetSchedule[0]!.timezone_type).toBe('');
    expect(Number.isNaN(result.adsetSchedule[0]!.start_minute)).toBe(true);
    expect(Number.isNaN(result.adsetSchedule[0]!.end_minute)).toBe(true);
  });

  it('throws MetaApiError when Meta rejects the read', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Unsupported get request', code: 100 } }),
    } as Response);

    await expect(fetchMetaAdSetSchedule('adset_123', 'token')).rejects.toThrow(MetaApiError);
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
