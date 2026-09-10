import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Evergreen delivery schedule at publish (tasks/SPEC-evergreen-delivery-schedule.md).
// The Meta client, Supabase and management links are mocked, mirroring
// tests/lib/campaigns/food-booking-publish.test.ts. The request bodies themselves are
// covered in tests/lib/meta/marketing.test.ts.
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/meta/marketing', () => ({
  createMetaCampaign: vi.fn(),
  createMetaAdSet: vi.fn(),
  uploadMetaImage: vi.fn(),
  createMetaAdCreative: vi.fn(),
  createMetaAd: vi.fn(),
  pauseMetaObject: vi.fn(),
  setMetaObjectStatus: vi.fn(),
  searchMetaGeoLocations: vi.fn(),
  fetchMetaObjectInsights: vi.fn(),
  fetchMetaAdSetSchedule: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    constructor(message: string, public code: number) { super(message); }
  },
}));

vi.mock('@/lib/management-app/data', () => ({
  getManagementConnectionConfig: vi.fn(),
}));

vi.mock('@/lib/management-app/client', () => ({
  createManagementMetaAdsLink: vi.fn(),
  ManagementApiError: class ManagementApiError extends Error {
    constructor(public code: string, message: string, public status?: number) { super(message); }
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/publishing/audit', () => ({
  logPublishAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import * as marketing from '@/lib/meta/marketing';
import { createManagementMetaAdsLink } from '@/lib/management-app/client';
import { getManagementConnectionConfig } from '@/lib/management-app/data';
import { logPublishAuditEvent } from '@/lib/publishing/audit';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: mockUpdate,
  eq: mockEq,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  storage: {
    from: vi.fn().mockReturnThis(),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/image.jpg' }, error: null }),
  },
};

// Weekday lunch: Tuesday to Friday, 09:00 to 14:00, as stored and as sent to Meta.
const LUNCH_SCHEDULE = {
  days: ['tuesday', 'wednesday', 'thursday', 'friday'],
  startHour: 9,
  endHour: 14,
};
const META_LUNCH_SCHEDULE = [
  { start_minute: 540, end_minute: 840, days: [2, 3, 4, 5], timezone_type: 'ADVERTISER' },
];

function evergreenCampaignRow(over: Record<string, unknown> = {}) {
  return {
    id: 'campaign-123',
    account_id: 'account-123',
    meta_campaign_id: null,
    name: 'Weekday Lunch',
    objective: 'OUTCOME_TRAFFIC',
    special_ad_category: 'NONE',
    budget_type: 'LIFETIME',
    budget_amount: 180,
    geo_radius_miles: 5,
    audience_mode: 'local_only',
    resolved_interests: [],
    campaign_kind: 'evergreen',
    source_snapshot: { campaignKind: 'evergreen', shortCode: 'ma-lunch' },
    start_date: '2026-09-15',
    end_date: '2026-10-09',
    destination_url: 'https://l.the-anchor.pub/ma-lunch',
    delivery_schedule: LUNCH_SCHEDULE,
    ...over,
  };
}

// Conversion optimisation off, as on The Anchor's live account: traffic objective.
function adAccountRow(over: Record<string, unknown> = {}) {
  return {
    access_token: 'token',
    meta_account_id: 'act_123',
    meta_pixel_id: null,
    conversion_event_name: 'Purchase',
    conversion_optimisation_enabled: false,
    timezone: 'Europe/London',
    ...over,
  };
}

function evergreenAdSetRow(over: Record<string, unknown> = {}) {
  return {
    id: 'adset-1',
    meta_adset_id: null,
    name: 'Evergreen Test',
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
    optimisation_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    budget_amount: null,
    phase_start: '2026-09-15',
    phase_end: '2026-10-09',
    adset_media_asset_id: 'asset-1',
    ads: [
      {
        id: 'ad-1',
        meta_ad_id: null,
        name: 'Burger lunch',
        headline: 'Lunch now served, Tue to Fri, 12 to 3',
        primary_text: 'We are now serving lunch Tuesday to Friday, 12pm to 3pm.',
        description: 'Burgers from £11',
        cta: 'BOOK_NOW',
        media_asset_id: null,
        utm_content_key: 'weekday_lunch_burger',
      },
    ],
    ...over,
  };
}

/** Queue the publish lookups: campaign, ad account, token expiry, FB page, posting defaults, ad sets, media asset. */
function queuePublishLookups(opts: {
  campaign?: Record<string, unknown>;
  adAccount?: Record<string, unknown>;
  adSets?: unknown[];
} = {}) {
  const adSets = opts.adSets ?? [evergreenAdSetRow()];
  mockSingle.mockResolvedValueOnce({ data: evergreenCampaignRow(opts.campaign) });
  mockSingle.mockResolvedValueOnce({ data: adAccountRow(opts.adAccount) });
  mockSingle.mockResolvedValueOnce({
    data: { token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
  });
  mockSingle.mockResolvedValueOnce({ data: { metadata: { pageId: 'page_123' } } });
  mockMaybeSingle.mockResolvedValueOnce({
    data: { venue_location: null, venue_latitude: 51.4625, venue_longitude: -0.5021 },
  });
  mockEq.mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    data: adSets,
  });
  for (let i = 0; i < adSets.length; i++) {
    mockSingle.mockResolvedValueOnce({ data: { storage_path: 'asset.jpg' } });
  }
}

function stubMetaCreateSuccess() {
  vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
  vi.mocked(marketing.createMetaAdSet).mockResolvedValue({ id: 'meta_adset_123' });
  vi.mocked(marketing.uploadMetaImage).mockResolvedValue({ hash: 'image_hash' });
  vi.mocked(marketing.createMetaAdCreative).mockResolvedValue({ id: 'creative_123' });
  vi.mocked(marketing.createMetaAd).mockResolvedValue({ id: 'meta_ad_123' });
  vi.mocked(marketing.fetchMetaAdSetSchedule).mockResolvedValue({
    pacingType: ['day_parting'],
    adsetSchedule: META_LUNCH_SCHEDULE,
  });
}

const META_CLIENT_FUNCTIONS = [
  'createMetaCampaign',
  'createMetaAdSet',
  'uploadMetaImage',
  'createMetaAdCreative',
  'createMetaAd',
  'pauseMetaObject',
  'setMetaObjectStatus',
  'searchMetaGeoLocations',
  'fetchMetaObjectInsights',
  'fetchMetaAdSetSchedule',
] as const;

function expectNoMetaCalls() {
  for (const name of META_CLIENT_FUNCTIONS) {
    expect(vi.mocked(marketing[name]), name).not.toHaveBeenCalled();
  }
}

function lastAdSetArgs() {
  return vi.mocked(marketing.createMetaAdSet).mock.calls[0]![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps queued mockResolvedValueOnce entries; reset so no test leaks into the next.
  mockSingle.mockReset();
  mockMaybeSingle.mockReset();
  mockUpdate.mockReset();
  mockEq.mockReset();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, maybeSingle: mockMaybeSingle, data: [] });
  mockSingle.mockResolvedValue({ data: { storage_path: 'asset.jpg' } });
  mockMaybeSingle.mockResolvedValue({ data: null });
  vi.mocked(getManagementConnectionConfig).mockResolvedValue({
    baseUrl: 'https://management.example.com',
    apiKey: 'key',
    enabled: true,
  });
  vi.mocked(createManagementMetaAdsLink).mockImplementation(async (_config, input) => ({
    shortUrl: input.parentShortCode ? `https://l.the-anchor.pub/${input.parentShortCode}` : 'https://l.the-anchor.pub/ma-generated',
    shortCode: input.parentShortCode ?? 'ma-generated',
    destinationUrl: input.destinationUrl,
    utmDestinationUrl: input.destinationUrl,
    alreadyExists: Boolean(input.parentShortCode),
    variants: (input.variants ?? []).map((variant, index) => ({
      shortUrl: `https://l.the-anchor.pub/mv${index + 1}`,
      shortCode: `mv${index + 1}`,
      destinationUrl: input.destinationUrl,
      utmDestinationUrl: `${input.destinationUrl}?utm_content=${variant.utmContent}`,
      utmContent: variant.utmContent,
      parentShortCode: input.parentShortCode ?? 'ma-generated',
      alreadyExists: false,
    })),
  }));
  mockSupabase.storage.from.mockReturnThis();
  mockSupabase.storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://example.com/image.jpg' },
    error: null,
  });
});

describe('publishCampaign with a delivery schedule', () => {
  it('passes the Meta schedule to the lifetime-budget ad set and confirms it before switching anything on', async () => {
    queuePublishLookups();
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result).toEqual({ success: true });
    expect(marketing.createMetaAdSet).toHaveBeenCalledTimes(1);
    const args = lastAdSetArgs();
    expect(args.schedule).toEqual(META_LUNCH_SCHEDULE);
    expect(args.lifetimeBudget).toBe(180);
    expect(args.dailyBudget).toBeUndefined();
    expect(args.parentUsesCampaignBudgetOptimization).toBeUndefined();
    // London midnight on 15 September (BST) to the midnight after 9 October (BST), in UTC.
    expect(args.startTime).toBe('2026-09-14T23:00:00.000Z');
    expect(args.endTime).toBe('2026-10-09T23:00:00.000Z');
    // Evergreen never uses campaign budget optimisation, so the schedule belongs on the ad set.
    expect(vi.mocked(marketing.createMetaCampaign).mock.calls[0]![0].useCampaignBudgetOptimization).toBeUndefined();

    expect(marketing.fetchMetaAdSetSchedule).toHaveBeenCalledWith('meta_adset_123', 'token');
    const readBackOrder = vi.mocked(marketing.fetchMetaAdSetSchedule).mock.invocationCallOrder[0]!;
    expect(readBackOrder).toBeLessThan(vi.mocked(marketing.createMetaAd).mock.invocationCallOrder[0]!);
    expect(readBackOrder).toBeLessThan(vi.mocked(marketing.setMetaObjectStatus).mock.invocationCallOrder[0]!);
    expect(marketing.setMetaObjectStatus).toHaveBeenCalledWith('meta_camp_123', 'token', 'ACTIVE');
  });

  it('keeps the same schedule across the 25 October 2026 clock change, with the flight times in the right offsets', async () => {
    queuePublishLookups({
      campaign: { start_date: '2026-10-20', end_date: '2026-10-30' },
      adSets: [evergreenAdSetRow({ phase_start: '2026-10-20', phase_end: '2026-10-30' })],
    });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result).toEqual({ success: true });
    const args = lastAdSetArgs();
    expect(args.schedule).toEqual(META_LUNCH_SCHEDULE);
    expect(args.startTime).toBe('2026-10-19T23:00:00.000Z'); // 20 Oct 00:00 BST
    expect(args.endTime).toBe('2026-10-31T00:00:00.000Z'); // 31 Oct 00:00 GMT
  });

  it('confirms the schedule on a resumed ad set too, so a retry never activates one without it', async () => {
    queuePublishLookups({
      campaign: { meta_campaign_id: 'meta_camp_existing' },
      adSets: [evergreenAdSetRow({ meta_adset_id: 'meta_adset_existing' })],
    });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result).toEqual({ success: true });
    expect(marketing.createMetaAdSet).not.toHaveBeenCalled();
    expect(marketing.fetchMetaAdSetSchedule).toHaveBeenCalledWith('meta_adset_existing', 'token');
  });
});

describe('publishCampaign without a delivery schedule', () => {
  it('creates the ad set exactly as before: no schedule field and no read-back', async () => {
    // Even an ad account outside Europe/London publishes, because the time zone only matters
    // to a scheduled campaign.
    queuePublishLookups({
      campaign: { delivery_schedule: null },
      adAccount: { timezone: 'America/New_York' },
    });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result).toEqual({ success: true });
    expect('schedule' in lastAdSetArgs()).toBe(false);
    expect(lastAdSetArgs().lifetimeBudget).toBe(180);
    expect(marketing.fetchMetaAdSetSchedule).not.toHaveBeenCalled();
  });

  it('treats a missing column value the same as null', async () => {
    queuePublishLookups({ campaign: { delivery_schedule: undefined } });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result).toEqual({ success: true });
    expect('schedule' in lastAdSetArgs()).toBe(false);
    expect(marketing.fetchMetaAdSetSchedule).not.toHaveBeenCalled();
  });
});

describe('publishCampaign refuses a delivery schedule before any Meta call', () => {
  it.each<[string, { campaign?: Record<string, unknown>; adAccount?: Record<string, unknown> }, RegExp]>([
    ['a daily budget', { campaign: { budget_type: 'DAILY' } }, /need a total budget/],
    ['an ad account outside Europe/London', { adAccount: { timezone: 'America/New_York' } }, /which is America\/New_York\. It must be Europe\/London/],
    ['an ad account with no recorded time zone', { adAccount: { timezone: null } }, /which is not recorded\. It must be Europe\/London/],
    ['a malformed stored schedule', { campaign: { delivery_schedule: { days: ['tuesday'], startHour: 9 } } }, /whole hours/],
    ['a stored array', { campaign: { delivery_schedule: ['tuesday'] } }, /not valid/],
    ['a stored schedule on an event campaign', { campaign: { campaign_kind: 'event' } }, /only available for evergreen/],
    ['a flight with no scheduled day', { campaign: { start_date: '2026-09-19', end_date: '2026-09-21' } }, /None of the chosen delivery days/],
  ])('refuses %s', async (_label, overrides, message) => {
    queuePublishLookups(overrides);
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.error).toMatch(message);
    expectNoMetaCalls();
    // The reason is saved for the detail page, and no publish attempt is audited.
    expect(mockUpdate).toHaveBeenCalledWith({ publish_error: result.error });
    expect(logPublishAuditEvent).not.toHaveBeenCalled();
  });
});

describe('publishCampaign rolls back when Meta does not confirm the schedule', () => {
  it.each<[string, { pacingType: string[]; adsetSchedule: typeof META_LUNCH_SCHEDULE }]>([
    ['reports Monday as a delivery day', {
      pacingType: ['day_parting'],
      adsetSchedule: [{ ...META_LUNCH_SCHEDULE[0]!, days: [1, 2, 3, 4, 5] }],
    }],
    ['drops day parting', { pacingType: ['standard'], adsetSchedule: META_LUNCH_SCHEDULE }],
    ['reports the viewer time zone', {
      pacingType: ['day_parting'],
      adsetSchedule: [{ ...META_LUNCH_SCHEDULE[0]!, timezone_type: 'USER' }],
    }],
    ['returns no schedule', { pacingType: [], adsetSchedule: [] }],
  ])('pauses what was created and returns to draft when Meta %s', async (_label, readBack) => {
    queuePublishLookups();
    stubMetaCreateSuccess();
    vi.mocked(marketing.fetchMetaAdSetSchedule).mockResolvedValue(readBack);

    const result = await publishCampaign('campaign-123');

    expect(result.error).toMatch(/Meta did not confirm the delivery schedule for "Evergreen Test" \(expected Tuesday to Friday, 09:00 to 14:00, UK time\)/);
    // Nothing was switched on, and the bad ad set never got ads.
    expect(marketing.setMetaObjectStatus).not.toHaveBeenCalled();
    expect(marketing.createMetaAd).not.toHaveBeenCalled();
    // The existing rollback: pause every object created in this attempt, reset to draft.
    expect(marketing.pauseMetaObject).toHaveBeenCalledWith('meta_camp_123', 'token');
    expect(marketing.pauseMetaObject).toHaveBeenCalledWith('meta_adset_123', 'token');
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'DRAFT', meta_status: null });
    expect(mockUpdate).toHaveBeenCalledWith({ publish_error: result.error });
    const ops = vi.mocked(logPublishAuditEvent).mock.calls.map((call) => call[0].operationType);
    expect(ops).toEqual(['publish_attempt', 'publish_failure']);
  });

  it('rolls back the same way when the read-back request itself fails', async () => {
    queuePublishLookups();
    stubMetaCreateSuccess();
    vi.mocked(marketing.fetchMetaAdSetSchedule).mockRejectedValue(new Error('Meta read timed out'));

    const result = await publishCampaign('campaign-123');

    expect(result.error).toBe('Meta read timed out');
    expect(marketing.setMetaObjectStatus).not.toHaveBeenCalled();
    expect(marketing.pauseMetaObject).toHaveBeenCalledWith('meta_adset_123', 'token');
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'DRAFT', meta_status: null });
  });
});
