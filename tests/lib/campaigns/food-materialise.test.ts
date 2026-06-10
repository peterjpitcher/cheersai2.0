/**
 * PR10 (3c) — weekly food-window materialisation helper.
 *
 * Two surfaces under test:
 *  - selectNextWeekFoodWindows (pure): deterministic target-week selection + idempotent skip.
 *  - materialiseFoodWindowsForCampaign (side-effecting): no-op guards, happy-path Meta creation,
 *    double-run idempotency, and PR9 spend-cap wiring.
 *
 * Meta client, Supabase, audit logging, and @/env are mocked — no live calls, no real DB.
 * Mirrors the mocking style of tests/lib/campaigns/food-booking-publish.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/meta/marketing', () => ({
  createMetaAdSet: vi.fn(),
  createMetaAdCreative: vi.fn(),
  createMetaAd: vi.fn(),
  uploadMetaImage: vi.fn(),
  setMetaObjectStatus: vi.fn(),
}));

vi.mock('@/lib/publishing/audit', () => ({
  logPublishAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logging', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// Mutable featureFlags so individual tests can toggle Phase 3 food optimisation (PR9 caps).
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, foodBooking: true, foodOptimisation: false },
  };
});

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { featureFlags } from '@/env';
import * as marketing from '@/lib/meta/marketing';
import { logPublishAuditEvent } from '@/lib/publishing/audit';
import {
  selectNextWeekFoodWindows,
  materialiseFoodWindowsForCampaign,
  isoWeekLabel,
  foodWindowOccurrenceKey,
} from '@/lib/campaigns/food-materialise';
import type { FoodBookingBrief } from '@/types/campaigns';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUNDAY_ROAST_BRIEF: FoodBookingBrief = {
  services: [
    {
      serviceKey: 'sunday_roast',
      enabled: true,
      days: ['sunday'],
      startLocal: '13:00',
      endLocal: '18:00',
      lastOrdersLocal: '17:30',
    },
  ],
  bookingUrl: 'https://www.the-anchor.pub/book',
  serviceBookingUrls: {},
  foodHooks: [],
  weeks: 2,
  dayWeighting: 'even',
};

const CAMPAIGN_START = '2026-06-09';
// Cron run on Sun 2026-06-14 (ISO week 24). Target = week24 start + 2 weeks → service 2026-06-28.
const REFERENCE_ISO = '2026-06-14T01:00:00.000Z';

/** Occurrence keys for the seeded publish-time ad sets (morning_commit on 06-14 + 06-21). */
const SEEDED_KEYS = [
  foodWindowOccurrenceKey('sunday_roast', 'morning_commit', '2026-06-14'),
  foodWindowOccurrenceKey('sunday_roast', 'morning_commit', '2026-06-21'),
];

/** Occurrence keys for all four default-on Sunday-roast windows serving 2026-06-28. */
const WEEK_0628_KEYS = [
  foodWindowOccurrenceKey('sunday_roast', 'planning', '2026-06-26'),
  foodWindowOccurrenceKey('sunday_roast', 'tomorrow', '2026-06-27'),
  foodWindowOccurrenceKey('sunday_roast', 'morning_commit', '2026-06-28'),
  foodWindowOccurrenceKey('sunday_roast', 'last_tables', '2026-06-28'),
];

interface FakeAdSetRecord {
  id: string;
  meta_adset_id: string | null;
  service_key: string | null;
  decision_stage: string | null;
  phase_start: string | null;
  targeting: Record<string, unknown>;
  placements: unknown;
  optimisation_goal: string;
  bid_strategy: string;
  adset_media_asset_id: string | null;
  status?: string;
  meta_status?: string | null;
  ads: Array<Record<string, unknown>>;
}

/** Post-Meta DB writes that can be made to fail, one per F3 injection point. */
type FakeFailTarget = 'adSetMetaIdUpdate' | 'adCreativeUpdate' | 'adMetaIdUpdate' | 'adSetActivate';

/** The two weeks materialised at publish for the Sunday-roast brief (service 06-14 + 06-21). */
function seededAdSets(): FakeAdSetRecord[] {
  const make = (runDate: string, idSuffix: string): FakeAdSetRecord => ({
    id: `seed-${idSuffix}`,
    meta_adset_id: `meta-${idSuffix}`,
    service_key: 'sunday_roast',
    decision_stage: 'morning_commit',
    phase_start: runDate,
    targeting: { age_min: 18, geo_locations: { countries: ['GB'] } },
    placements: { facebook_positions: ['feed'] },
    optimisation_goal: 'OFFSITE_CONVERSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    adset_media_asset_id: 'asset-1',
    ads: [
      {
        name: 'Sunday roast — morning commit',
        headline: 'Book your roast',
        primary_text: 'Roasts from 1pm — reserve your table.',
        description: 'Reserve now',
        cta: 'BOOK_NOW',
        creative_brief: 'Warm roast photo',
        angle: 'Comfort',
        creative_format: 'venue_photo',
        creative_variant_key: 'sunday_roast_morning_v1',
        media_asset_id: null,
      },
    ],
  });
  // morning_commit ad sets run on the service date itself.
  return [make('2026-06-14', 'wk1'), make('2026-06-21', 'wk2')];
}

interface CampaignOverrides {
  campaign_kind?: string | null;
  status?: string;
  meta_campaign_id?: string | null;
  budget_amount?: number;
}

function campaignRow(over: CampaignOverrides = {}) {
  return {
    id: 'campaign-123',
    account_id: 'account-123',
    meta_campaign_id: over.meta_campaign_id === undefined ? 'meta_camp_1' : over.meta_campaign_id,
    name: 'Sunday Roast Bookings',
    budget_amount: over.budget_amount ?? 200,
    campaign_kind: over.campaign_kind === undefined ? 'food_booking' : over.campaign_kind,
    status: over.status ?? 'ACTIVE',
    destination_url: 'https://www.the-anchor.pub/book?utm_source=facebook',
    source_snapshot: {
      campaignKind: 'food_booking',
      brief: SUNDAY_ROAST_BRIEF,
      foodSchedule: [{ runDate: '2026-06-12' }, { runDate: '2026-06-13' }],
      windowOverrides: {},
      serviceBookingUrls: {},
    },
  };
}

/**
 * A stateful fake Supabase: ad_set inserts/updates/deletes and ad inserts/updates all apply to
 * `adSetStore` (deletes cascade to ads, mirroring the real FK), and the ad_sets select returns
 * that store — so a second materialise run sees exactly what the first persisted, including
 * incomplete rows left behind by a mid-run failure (F2). `failOn` makes a single post-Meta DB
 * write fail (F3); `adSetInsertError` makes every ad_sets insert fail (F7's 23505 path).
 */
function makeFakeSupabase(opts: {
  campaign: Record<string, unknown> | null;
  adSetStore: FakeAdSetRecord[];
  conversionReady?: boolean;
  pageConnected?: boolean;
  failOn?: FakeFailTarget;
  adSetInsertError?: { code?: string; message: string };
}) {
  let adSetIdCounter = 0;
  let adIdCounter = 0;

  const adAccountRow = {
    access_token: 'token',
    meta_account_id: 'act_123',
    token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    meta_pixel_id: opts.conversionReady === false ? null : '123456789012345',
    conversion_event_name: 'Purchase',
    conversion_optimisation_enabled: true,
  };

  const findAd = (adId: string): Record<string, unknown> | undefined => {
    for (const adSet of opts.adSetStore) {
      const ad = adSet.ads.find((candidate) => candidate.id === adId);
      if (ad) return ad;
    }
    return undefined;
  };

  const from = vi.fn((table: string) => {
    if (table === 'meta_campaigns') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.campaign, error: null }) }),
        }),
      };
    }

    if (table === 'ad_sets') {
      return {
        // Read existing ad sets: .select(...).eq('campaign_id', id) resolves to { data }.
        select: () => ({
          eq: () => Promise.resolve({ data: opts.adSetStore, error: null }),
        }),
        // Insert a new ad set: .insert(row).select('id').single().
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              if (opts.adSetInsertError) {
                return Promise.resolve({ data: null, error: opts.adSetInsertError });
              }
              adSetIdCounter += 1;
              const id = `new-adset-${adSetIdCounter}`;
              opts.adSetStore.push({
                id,
                meta_adset_id: null,
                service_key: (row.service_key as string) ?? null,
                decision_stage: (row.decision_stage as string) ?? null,
                phase_start: (row.phase_start as string) ?? null,
                targeting: (row.targeting as Record<string, unknown>) ?? {},
                placements: row.placements ?? {},
                optimisation_goal: (row.optimisation_goal as string) ?? 'OFFSITE_CONVERSIONS',
                bid_strategy: (row.bid_strategy as string) ?? 'LOWEST_COST_WITHOUT_CAP',
                adset_media_asset_id: (row.adset_media_asset_id as string) ?? null,
                status: (row.status as string) ?? 'DRAFT',
                meta_status: null,
                ads: [],
              });
              return Promise.resolve({ data: { id }, error: null });
            },
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: (_column: string, id: string) => {
            if (opts.failOn === 'adSetMetaIdUpdate' && 'meta_adset_id' in values) {
              return Promise.resolve({ data: null, error: { message: 'injected ad_sets meta-id update failure' } });
            }
            if (opts.failOn === 'adSetActivate' && values.status === 'ACTIVE') {
              return Promise.resolve({ data: null, error: { message: 'injected ad_sets activate update failure' } });
            }
            const target = opts.adSetStore.find((adSet) => adSet.id === id);
            if (target) Object.assign(target, values);
            return Promise.resolve({ data: null, error: null });
          },
        }),
        delete: () => ({
          eq: (_column: string, id: string) => {
            const index = opts.adSetStore.findIndex((adSet) => adSet.id === id);
            // Removing the row drops its ads with it — mirrors the ads.adset_id CASCADE FK.
            if (index >= 0) opts.adSetStore.splice(index, 1);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    }

    if (table === 'ads') {
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              adIdCounter += 1;
              const id = `new-ad-${adIdCounter}`;
              const parent = opts.adSetStore.find((adSet) => adSet.id === row.adset_id);
              parent?.ads.push({ id, ...row });
              return Promise.resolve({ data: { id }, error: null });
            },
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: (_column: string, id: string) => {
            if (opts.failOn === 'adCreativeUpdate' && 'meta_creative_id' in values) {
              return Promise.resolve({ data: null, error: { message: 'injected ads creative update failure' } });
            }
            if (opts.failOn === 'adMetaIdUpdate' && 'meta_ad_id' in values) {
              return Promise.resolve({ data: null, error: { message: 'injected ads meta-id update failure' } });
            }
            const ad = findAd(id);
            if (ad) Object.assign(ad, values);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    }

    if (table === 'media_assets') {
      return {
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: { storage_path: 'asset.jpg' }, error: null }) }),
        }),
      };
    }

    if (table === 'meta_ad_accounts') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: adAccountRow, error: null }) }),
        }),
      };
    }

    if (table === 'social_connections') {
      const metadata = opts.pageConnected === false ? null : { pageId: 'page_123' };
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { metadata }, error: null }) }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    from,
    storage: {
      from: () => ({
        createSignedUrl: () =>
          Promise.resolve({ data: { signedUrl: 'https://example.com/i.jpg' }, error: null }),
      }),
    },
  };
}

function stubMetaSuccess() {
  vi.mocked(marketing.createMetaAdSet).mockImplementation(async () => ({
    id: `meta_adset_${Math.random().toString(36).slice(2, 8)}`,
  }));
  vi.mocked(marketing.uploadMetaImage).mockResolvedValue({ hash: 'image_hash' });
  vi.mocked(marketing.createMetaAdCreative).mockResolvedValue({ id: 'creative_1' });
  vi.mocked(marketing.createMetaAd).mockResolvedValue({ id: 'meta_ad_1' });
  vi.mocked(marketing.setMetaObjectStatus).mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlags.foodOptimisation = false;
  stubMetaSuccess();
});

// ---------------------------------------------------------------------------
// Pure: selectNextWeekFoodWindows
// ---------------------------------------------------------------------------

describe('selectNextWeekFoodWindows', () => {
  it('selects exactly the deterministic target week (rolling weeks ahead of the reference)', () => {
    const windows = selectNextWeekFoodWindows({
      brief: SUNDAY_ROAST_BRIEF,
      campaignStartDate: CAMPAIGN_START,
      existingWindowKeys: new Set(SEEDED_KEYS),
      referenceIso: REFERENCE_ISO,
    });
    const serviceDates = [...new Set(windows.map((w) => w.serviceDate))];
    expect(serviceDates).toEqual(['2026-06-28']);
    // Default-on Sunday-roast windows: planning, tomorrow, morning_commit, last_tables.
    expect(windows).toHaveLength(4);
  });

  it('is idempotent: returns [] when the target week is already materialised', () => {
    const windows = selectNextWeekFoodWindows({
      brief: SUNDAY_ROAST_BRIEF,
      campaignStartDate: CAMPAIGN_START,
      // All four 06-28 windows already present → same reference resolves to the same
      // (now-filled) week.
      existingWindowKeys: new Set([...SEEDED_KEYS, ...WEEK_0628_KEYS]),
      referenceIso: REFERENCE_ISO,
    });
    expect(windows).toEqual([]);
  });

  it('F2: re-selects ONLY the missing windows of a partially-materialised week', () => {
    // planning + tomorrow completed before a mid-run failure; morning_commit and
    // last_tables must come back — and nothing else.
    const windows = selectNextWeekFoodWindows({
      brief: SUNDAY_ROAST_BRIEF,
      campaignStartDate: CAMPAIGN_START,
      existingWindowKeys: new Set([
        ...SEEDED_KEYS,
        foodWindowOccurrenceKey('sunday_roast', 'planning', '2026-06-26'),
        foodWindowOccurrenceKey('sunday_roast', 'tomorrow', '2026-06-27'),
      ]),
      referenceIso: REFERENCE_ISO,
    });
    expect(windows.map((w) => w.windowKey).sort()).toEqual([
      'sunday_roast_last_tables',
      'sunday_roast_morning',
    ]);
  });

  it('advances by one week when the cron runs a week later', () => {
    const windows = selectNextWeekFoodWindows({
      brief: SUNDAY_ROAST_BRIEF,
      campaignStartDate: CAMPAIGN_START,
      existingWindowKeys: new Set([...SEEDED_KEYS, ...WEEK_0628_KEYS]),
      referenceIso: '2026-06-21T01:00:00.000Z',
    });
    expect([...new Set(windows.map((w) => w.serviceDate))]).toEqual(['2026-07-05']);
  });

  it('honours windowOverrides to switch a default-off rescue window on', () => {
    const windows = selectNextWeekFoodWindows({
      brief: SUNDAY_ROAST_BRIEF,
      campaignStartDate: CAMPAIGN_START,
      existingWindowKeys: new Set(SEEDED_KEYS),
      referenceIso: REFERENCE_ISO,
      windowOverrides: { sunday_roast_last_tables: false },
    });
    // last_tables is default-on; toggling it off drops it from the 4 → 3.
    expect(windows.some((w) => w.windowKey === 'sunday_roast_last_tables')).toBe(false);
    expect(windows).toHaveLength(3);
  });

  it('returns [] for an invalid reference timestamp', () => {
    expect(
      selectNextWeekFoodWindows({
        brief: SUNDAY_ROAST_BRIEF,
        campaignStartDate: CAMPAIGN_START,
        existingWindowKeys: new Set(),
        referenceIso: 'not-a-date',
      }),
    ).toEqual([]);
  });
});

describe('isoWeekLabel', () => {
  it('formats the London ISO week of an instant', () => {
    expect(isoWeekLabel('2026-06-14T01:00:00.000Z')).toBe('2026-W24');
  });
});

// ---------------------------------------------------------------------------
// Side-effecting: materialiseFoodWindowsForCampaign
// ---------------------------------------------------------------------------

describe('materialiseFoodWindowsForCampaign', () => {
  it('is a no-op for a non-food campaign (no Meta calls)', async () => {
    const fake = makeFakeSupabase({ campaign: campaignRow({ campaign_kind: 'event' }), adSetStore: seededAdSets() });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    const result = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

    expect(result.created).toBe(0);
    expect(marketing.createMetaAdSet).not.toHaveBeenCalled();
  });

  it('is a no-op for an unpublished (no meta_campaign_id) campaign', async () => {
    const fake = makeFakeSupabase({ campaign: campaignRow({ meta_campaign_id: null }), adSetStore: seededAdSets() });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    const result = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

    expect(result.created).toBe(0);
    expect(marketing.createMetaAdSet).not.toHaveBeenCalled();
  });

  it('is a no-op for a paused campaign', async () => {
    const fake = makeFakeSupabase({ campaign: campaignRow({ status: 'PAUSED' }), adSetStore: seededAdSets() });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    const result = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

    expect(result.created).toBe(0);
    expect(marketing.createMetaAdSet).not.toHaveBeenCalled();
  });

  it('creates the next week of ad sets on Meta and audits the run', async () => {
    const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: seededAdSets() });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    const result = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

    // 4 default-on Sunday-roast windows for service date 2026-06-28.
    expect(result.created).toBe(4);
    expect(result.serviceDates.every((d) => d === '2026-06-28')).toBe(true);
    expect(marketing.createMetaAdSet).toHaveBeenCalledTimes(4);
    // Each ad set is created PAUSED then activated; one ad each → activate ad + ad set.
    expect(marketing.createMetaAd).toHaveBeenCalledTimes(4);
    expect(marketing.setMetaObjectStatus).toHaveBeenCalled();
    expect(logPublishAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'state_transition',
        resourceId: 'campaign-123',
        accountId: 'account-123',
        details: expect.objectContaining({ action: 'materialise_food_windows', created: 4 }),
      }),
    );
  });

  it('is idempotent: a second run with the same reference creates nothing', async () => {
    const store = seededAdSets();
    const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: store });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    const first = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });
    expect(first.created).toBe(4);

    vi.mocked(marketing.createMetaAdSet).mockClear();

    // Second run sees the ad sets the first run inserted (store is shared) → nothing new.
    const second = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });
    expect(second.created).toBe(0);
    expect(marketing.createMetaAdSet).not.toHaveBeenCalled();
  });

  describe('F2 partial-failure retry', () => {
    it('completes a window whose first attempt failed after the DB insert, instead of skipping it', async () => {
      const store = seededAdSets();
      const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: store });
      vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

      // First delivery: the very first window's Meta ad-set creation fails AFTER the local
      // insert, stranding an incomplete row (no meta_adset_id, no ads).
      vi.mocked(marketing.createMetaAdSet).mockRejectedValueOnce(new Error('Meta 500'));
      await expect(
        materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO }),
      ).rejects.toThrow('Meta 500');
      expect(store.some((row) => !row.meta_adset_id && row.ads.length === 0)).toBe(true);

      // QStash retry (Meta healthy again): the incomplete remnant is cleaned up and the
      // whole week completes — the broken window is NOT treated as already done.
      const retry = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });
      expect(retry.created).toBe(4);
      expect(retry.serviceDates.every((d) => d === '2026-06-28')).toBe(true);
      // 2 seeds + 4 recreated windows; the remnant is gone and every row is complete.
      expect(store).toHaveLength(6);
      expect(store.every((row) => Boolean(row.meta_adset_id) && row.ads.length > 0)).toBe(true);
    });

    it('pauses the Meta remnant of an incomplete row (ad set created, ads never persisted) before recreating', async () => {
      // Failure mode: meta_adset_id was persisted but no ad row ever landed — a live-ish
      // Meta object with no local ads. The retry must pause it, delete the row, recreate.
      const remnant: FakeAdSetRecord = {
        id: 'broken-1',
        meta_adset_id: 'meta-broken-1',
        service_key: 'sunday_roast',
        decision_stage: 'planning',
        phase_start: '2026-06-26',
        targeting: {},
        placements: {},
        optimisation_goal: 'OFFSITE_CONVERSIONS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        adset_media_asset_id: 'asset-1',
        ads: [],
      };
      const store = [...seededAdSets(), remnant];
      const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: store });
      vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

      const result = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

      // The remnant was paused on Meta (best-effort) and removed locally…
      expect(marketing.setMetaObjectStatus).toHaveBeenCalledWith('meta-broken-1', 'token', 'PAUSED');
      expect(store.some((row) => row.id === 'broken-1')).toBe(false);
      // …and its window was recreated whole alongside the rest of the week.
      expect(result.created).toBe(4);
      expect(store).toHaveLength(6);
      // The two complete seeded rows were left untouched (still skipped).
      expect(store.filter((row) => row.id.startsWith('seed-'))).toHaveLength(2);
    });
  });

  it('F6: skips a target week whose rows lie far beyond the old reconstruction horizon', async () => {
    // The campaign anchor is 2026-06-09 with a 2-week brief. By late August the rolling
    // campaign has rows ~14 weeks past the anchor — beyond the old min(8, weeks+4)-week
    // reconstruction horizon, which would have failed to recognise them and double-created
    // the week. Keys now come straight from the rows, so the week is correctly skipped.
    const makeFarRow = (decisionStage: string, phaseStart: string, suffix: string): FakeAdSetRecord => ({
      id: `far-${suffix}`,
      meta_adset_id: `meta-far-${suffix}`,
      service_key: 'sunday_roast',
      decision_stage: decisionStage,
      phase_start: phaseStart,
      targeting: {},
      placements: {},
      optimisation_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      adset_media_asset_id: 'asset-1',
      ads: [{ name: 'far ad', media_asset_id: null }],
    });
    // Reference Sun 2026-08-30 → target service week Mon 2026-09-07..Sun 2026-09-13.
    const store = [
      ...seededAdSets(),
      makeFarRow('planning', '2026-09-11', 'planning'),
      makeFarRow('tomorrow', '2026-09-12', 'tomorrow'),
      makeFarRow('morning_commit', '2026-09-13', 'morning'),
      makeFarRow('last_tables', '2026-09-13', 'last-tables'),
    ];
    const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: store });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    const result = await materialiseFoodWindowsForCampaign({
      campaignId: 'campaign-123',
      referenceIso: '2026-08-30T01:00:00.000Z',
    });

    expect(result.created).toBe(0);
    expect(marketing.createMetaAdSet).not.toHaveBeenCalled();
    expect(store).toHaveLength(6);
  });

  it('forces BOOK_NOW and OFFSITE_CONVERSIONS with the pixel promoted object', async () => {
    const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: seededAdSets() });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

    expect(marketing.createMetaAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({ callToActionType: 'BOOK_NOW' }),
    );
    expect(marketing.createMetaAdSet).toHaveBeenCalledWith(
      expect.objectContaining({
        optimisationGoal: 'OFFSITE_CONVERSIONS',
        promotedObject: { pixel_id: '123456789012345', custom_event_type: 'PURCHASE' },
      }),
    );
  });

  describe('F4 conversion-gate re-check', () => {
    it('refuses to materialise anything when conversion readiness has lapsed (throw => worker 500)', async () => {
      const store = seededAdSets();
      const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: store, conversionReady: false });
      vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

      await expect(
        materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO }),
      ).rejects.toThrow(/conversion tracking/i);

      // NOTHING was created — no Meta objects, no local rows.
      expect(marketing.createMetaAdSet).not.toHaveBeenCalled();
      expect(store).toHaveLength(2);
      // The block is audit-logged with the reason.
      expect(logPublishAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'publish_failure',
          resourceId: 'campaign-123',
          details: expect.objectContaining({
            action: 'materialise_food_windows_blocked',
            reason: 'conversion_not_ready',
          }),
        }),
      );
    });

    it('never falls back to the template optimisation goal even when the template carries one', async () => {
      // Template rows store LINK_CLICKS; readiness is fine — the worker must still send
      // OFFSITE_CONVERSIONS for every new ad set (no template fallback path exists).
      const store = seededAdSets().map((row) => ({ ...row, optimisation_goal: 'LINK_CLICKS' }));
      const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: store });
      vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

      const result = await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

      expect(result.created).toBe(4);
      for (const call of vi.mocked(marketing.createMetaAdSet).mock.calls) {
        expect(call[0].optimisationGoal).toBe('OFFSITE_CONVERSIONS');
      }
    });
  });

  it('sends NO per-ad-set budget (campaign-level CBO) and no caps when the flag is off', async () => {
    const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: seededAdSets() });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

    for (const call of vi.mocked(marketing.createMetaAdSet).mock.calls) {
      expect(call[0].dailyBudget).toBeUndefined();
      expect(call[0].lifetimeBudget).toBeUndefined();
      expect(call[0].minBudget).toBeUndefined();
      expect(call[0].maxBudget).toBeUndefined();
      expect(call[0].parentUsesCampaignBudgetOptimization).toBeUndefined();
    }
  });

  it('applies PR9 CBO spend caps when the food optimisation flag is on', async () => {
    featureFlags.foodOptimisation = true;
    const fake = makeFakeSupabase({ campaign: campaignRow(), adSetStore: seededAdSets() });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(fake as never);

    await materialiseFoodWindowsForCampaign({ campaignId: 'campaign-123', referenceIso: REFERENCE_ISO });

    expect(marketing.createMetaAdSet).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(marketing.createMetaAdSet).mock.calls) {
      expect(call[0].parentUsesCampaignBudgetOptimization).toBe(true);
      expect(typeof call[0].minBudget).toBe('number');
      expect(typeof call[0].maxBudget).toBe('number');
    }
  });
});
