import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// PR4 — food_booking publish behaviour (intra-day start, CBO budget, conversion
// gate, BOOK_NOW). The Meta client + Supabase + management links are mocked,
// mirroring tests/lib/campaigns/publish.test.ts. Task 4.1 (the createMetaCampaign
// CBO request body) is unit-tested in tests/lib/meta/marketing.test.ts.
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
import { revalidatePath } from 'next/cache';
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

mockUpdate.mockReturnValue({ eq: mockEq });
mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, maybeSingle: mockMaybeSingle, data: [] });

// A trackable Anchor booking URL with attribution so the publish destination check passes.
const FOOD_DESTINATION_URL =
  'https://www.the-anchor.pub/book?utm_source=facebook&utm_medium=paid_social&utm_campaign=sunday-roast';

interface FoodAdSetRowOverrides {
  id?: string;
  phase_start?: string | null;
  phase_end?: string | null;
  ads_start_time?: string | null;
  ads_stop_time?: string | null;
  service_key?: string | null;
  decision_stage?: string | null;
  budget_amount?: number | null;
  utm_content_key?: string | null;
}

function foodAdSetRow(over: FoodAdSetRowOverrides = {}) {
  return {
    id: over.id ?? 'adset-1',
    meta_adset_id: null,
    name: 'Sunday roast — morning commit',
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
    optimisation_goal: 'OFFSITE_CONVERSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    budget_amount: over.budget_amount ?? null,
    phase_start: over.phase_start ?? '2026-06-14',
    phase_end: over.phase_end ?? '2026-06-14',
    ads_start_time: over.ads_start_time ?? '08:30',
    ads_stop_time: over.ads_stop_time ?? '11:30',
    service_key: over.service_key ?? 'sunday_roast',
    decision_stage: over.decision_stage ?? 'morning_commit',
    adset_media_asset_id: 'asset-1',
    ads: [
      {
        id: 'ad-1',
        meta_ad_id: null,
        name: 'Sunday roast — morning commit — Var 1',
        headline: 'Roast table',
        primary_text: 'Book a table for our Sunday roast, served from 1pm.',
        description: 'Reserve now',
        cta: 'LEARN_MORE',
        media_asset_id: null,
        utm_content_key: over.utm_content_key ?? 'sunday_roast_morning',
      },
    ],
  };
}

function foodCampaignRow(over: Record<string, unknown> = {}) {
  return {
    id: 'campaign-123',
    account_id: 'account-123',
    meta_campaign_id: null,
    name: 'Sunday Roast Bookings',
    objective: 'OUTCOME_SALES',
    special_ad_category: 'NONE',
    budget_type: 'LIFETIME',
    budget_amount: 200,
    geo_radius_miles: 3,
    audience_mode: 'local_only',
    resolved_interests: [],
    campaign_kind: 'food_booking',
    source_snapshot: { campaignKind: 'food_booking', bookingConversionOptimised: true },
    start_date: '2026-06-09',
    end_date: '2026-06-21',
    destination_url: FOOD_DESTINATION_URL,
    ...over,
  };
}

function readyAdAccountRow() {
  return {
    access_token: 'token',
    meta_account_id: 'act_123',
    meta_pixel_id: '123456789012345',
    conversion_event_name: 'Purchase',
    conversion_optimisation_enabled: true,
  };
}

/** Queue the standard publish lookups: campaign, ad account, token expiry, FB page, posting defaults, ad sets, media asset. */
function queueFoodPublishLookups(opts: {
  campaign?: Record<string, unknown>;
  adAccount?: Record<string, unknown> | null;
  adSets: unknown[];
}) {
  mockSingle.mockResolvedValueOnce({ data: foodCampaignRow(opts.campaign) }); // campaign
  mockSingle.mockResolvedValueOnce({ data: opts.adAccount === undefined ? readyAdAccountRow() : opts.adAccount }); // ad account
  mockSingle.mockResolvedValueOnce({
    data: { token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
  }); // token expiry
  mockSingle.mockResolvedValueOnce({ data: { metadata: { pageId: 'page_123' } } }); // FB page
  mockMaybeSingle.mockResolvedValueOnce({
    data: { venue_location: null, venue_latitude: 51.4625, venue_longitude: -0.5021 },
  }); // posting defaults
  mockEq.mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    data: opts.adSets,
  });
  // One media-asset lookup per ad set (each ad needs its creative image path).
  for (let i = 0; i < opts.adSets.length; i++) {
    mockSingle.mockResolvedValueOnce({ data: { storage_path: 'asset.jpg' } });
  }
}

function stubMetaCreateSuccess() {
  vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
  vi.mocked(marketing.createMetaAdSet).mockResolvedValue({ id: 'meta_adset_123' });
  vi.mocked(marketing.uploadMetaImage).mockResolvedValue({ hash: 'image_hash' });
  vi.mocked(marketing.createMetaAdCreative).mockResolvedValue({ id: 'creative_123' });
  vi.mocked(marketing.createMetaAd).mockResolvedValue({ id: 'meta_ad_123' });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does not flush queued mockResolvedValueOnce entries; reset them so a
  // test that errors early cannot leak leftover queue items into the next test.
  mockSingle.mockReset();
  mockMaybeSingle.mockReset();
  mockUpdate.mockReset();
  mockEq.mockReset();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, maybeSingle: mockMaybeSingle, data: [] });
  // Benign default for any unqueued .single() (e.g. trailing media-asset lookups) so a
  // missing queue entry never throws a destructure error mid-publish.
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
      utmDestinationUrl: `${input.destinationUrl}${input.destinationUrl.includes('?') ? '&' : '?'}utm_content=${variant.utmContent}`,
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

describe('publishCampaign — food_booking', () => {
  it('computes the ad set start_time from ads_start_time (not midnight)', async () => {
    queueFoodPublishLookups({ adSets: [foodAdSetRow()] });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    // 2026-06-14 is BST (UTC+1), so 08:30 local = 07:30 UTC; 11:30 local = 10:30 UTC.
    expect(marketing.createMetaAdSet).toHaveBeenCalledWith(expect.objectContaining({
      startTime: '2026-06-14T07:30:00.000Z',
      endTime: '2026-06-14T10:30:00.000Z',
    }));
  });

  it('uses campaign-level CBO with a lifetime budget and skips per-ad-set budgets', async () => {
    queueFoodPublishLookups({ adSets: [foodAdSetRow(), foodAdSetRow({ id: 'adset-2', utm_content_key: 'sunday_roast_last_tables' })] });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    // Lifetime CBO must carry a campaign end_time (flight end = latest ad set run date + 1
    // day → 2026-06-14 + 1 = 2026-06-15 midnight London = 2026-06-14T23:00Z in BST).
    expect(marketing.createMetaCampaign).toHaveBeenCalledWith(expect.objectContaining({
      useCampaignBudgetOptimization: true,
      lifetimeBudget: 200,
      endTime: '2026-06-14T23:00:00.000Z',
    }));
    const campaignArgs = vi.mocked(marketing.createMetaCampaign).mock.calls[0]![0];
    expect(campaignArgs.dailyBudget).toBeUndefined();
    // Per-ad-set budgets must NOT be sent for food_booking (the campaign owns the budget).
    for (const call of vi.mocked(marketing.createMetaAdSet).mock.calls) {
      expect(call[0].dailyBudget).toBeUndefined();
      expect(call[0].lifetimeBudget).toBeUndefined();
    }
  });

  it('uses a daily campaign budget and no campaign end_time when budget_type is DAILY', async () => {
    queueFoodPublishLookups({
      campaign: { budget_type: 'DAILY', budget_amount: 30 },
      adSets: [foodAdSetRow()],
    });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    const campaignArgs = vi.mocked(marketing.createMetaCampaign).mock.calls[0]![0];
    expect(campaignArgs.useCampaignBudgetOptimization).toBe(true);
    expect(campaignArgs.dailyBudget).toBe(30);
    expect(campaignArgs.lifetimeBudget).toBeUndefined();
    // Daily budgets do not need (and Meta rejects) a campaign end_time.
    expect(campaignArgs.endTime).toBeUndefined();
    // Budget still lives on the campaign, never on the ad sets.
    for (const call of vi.mocked(marketing.createMetaAdSet).mock.calls) {
      expect(call[0].dailyBudget).toBeUndefined();
      expect(call[0].lifetimeBudget).toBeUndefined();
    }
  });

  it('forces BOOK_NOW on the creative even when the ad CTA is something else', async () => {
    queueFoodPublishLookups({ adSets: [foodAdSetRow()] });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    expect(marketing.createMetaAdCreative).toHaveBeenCalledWith(expect.objectContaining({
      callToActionType: 'BOOK_NOW',
    }));
  });

  it('uses a Sunday roast booking URL override for Sunday roast ad sets', async () => {
    queueFoodPublishLookups({
      campaign: {
        source_snapshot: {
          campaignKind: 'food_booking',
          bookingConversionOptimised: true,
          serviceBookingUrls: {
            sunday_roast: 'https://www.the-anchor.pub/book-table?service=sunday-roast',
          },
        },
      },
      adSets: [foodAdSetRow({ utm_content_key: 'sunday_roast_morning-2026-06-14-venue-1' })],
    });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    expect(marketing.createMetaAdCreative).toHaveBeenCalledWith(expect.objectContaining({
      linkUrl: 'https://www.the-anchor.pub/book-table?service=sunday-roast&utm_content=sunday_roast_morning-2026-06-14-venue-1',
    }));
  });

  it('logs publish_attempt then publish_success on a successful publish', async () => {
    queueFoodPublishLookups({ adSets: [foodAdSetRow()] });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    const ops = vi.mocked(logPublishAuditEvent).mock.calls.map((c) => c[0].operationType);
    expect(ops).toEqual(['publish_attempt', 'publish_success']);
    expect(logPublishAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'publish_attempt',
        resourceType: 'content_item',
        resourceId: 'campaign-123',
        accountId: 'account-123',
      }),
    );
    expect(logPublishAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: 'publish_success', resourceId: 'campaign-123' }),
    );
  });

  it('logs publish_attempt then publish_failure when a Meta call fails', async () => {
    queueFoodPublishLookups({ adSets: [foodAdSetRow()] });
    stubMetaCreateSuccess();
    vi.mocked(marketing.createMetaAdSet).mockRejectedValueOnce(
      new marketing.MetaApiError('ad set rejected', 100),
    );

    const result = await publishCampaign('campaign-123');

    expect(result.error).toBeDefined();
    const ops = vi.mocked(logPublishAuditEvent).mock.calls.map((c) => c[0].operationType);
    expect(ops).toContain('publish_attempt');
    expect(ops).toContain('publish_failure');
    // Success must NOT be logged on the failure path.
    expect(ops).not.toContain('publish_success');
  });

  it('is blocked by the conversion gate when no pixel is configured', async () => {
    queueFoodPublishLookups({
      adSets: [foodAdSetRow()],
      adAccount: {
        access_token: 'token',
        meta_account_id: 'act_123',
        meta_pixel_id: null,
        conversion_event_name: 'Purchase',
        conversion_optimisation_enabled: true,
      },
    });

    const result = await publishCampaign('campaign-123');

    expect(result.error).toContain('conversion tracking is ready');
    expect(marketing.createMetaCampaign).not.toHaveBeenCalled();
    // The gate blocks before any publish attempt, so no audit event is emitted.
    expect(logPublishAuditEvent).not.toHaveBeenCalled();
  });

  it('revalidates the campaign detail and list routes after publishing', async () => {
    queueFoodPublishLookups({ adSets: [foodAdSetRow()] });
    stubMetaCreateSuccess();

    await publishCampaign('campaign-123');

    expect(revalidatePath).toHaveBeenCalledWith('/campaigns');
    expect(revalidatePath).toHaveBeenCalledWith('/campaigns/campaign-123');
  });
});

describe('publishCampaign — event/evergreen unchanged by PR4', () => {
  it('keeps midnight ad set start and per-ad-set budgets for evergreen campaigns', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Evergreen',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 40,
        geo_radius_miles: 3,
        start_date: '2026-04-01',
        end_date: '2026-04-10',
        destination_url: 'https://vip-club.uk/ma123',
      },
    });
    mockSingle.mockResolvedValueOnce({ data: { access_token: 'token', meta_account_id: 'act_123' } });
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
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Evergreen',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          budget_amount: null,
          phase_start: '2026-04-01',
          phase_end: '2026-04-10',
          adset_media_asset_id: 'asset-1',
          ads: [
            {
              id: 'ad-1',
              meta_ad_id: null,
              name: 'Ad 1',
              headline: 'Test',
              primary_text: 'Primary text',
              description: 'Description',
              cta: 'LEARN_MORE',
              media_asset_id: null,
            },
          ],
        },
      ],
    });
    mockSingle.mockResolvedValueOnce({ data: { storage_path: 'asset.jpg' } });
    stubMetaCreateSuccess();

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    // Midnight start (BST: 2026-04-01 00:00 local = 2026-03-31 23:00 UTC); per-ad-set lifetime budget applied.
    expect(marketing.createMetaAdSet).toHaveBeenCalledWith(expect.objectContaining({
      startTime: '2026-03-31T23:00:00.000Z',
      lifetimeBudget: 40,
    }));
    // Evergreen does not use CBO — the campaign request omits the CBO flag, any campaign
    // budget, and the campaign-level end_time entirely (behaviour unchanged by CR-2).
    const campaignArgs = vi.mocked(marketing.createMetaCampaign).mock.calls[0]![0];
    expect(campaignArgs.useCampaignBudgetOptimization).toBeUndefined();
    expect(campaignArgs.lifetimeBudget).toBeUndefined();
    expect(campaignArgs.dailyBudget).toBeUndefined();
    expect(campaignArgs.endTime).toBeUndefined();
  });
});
