import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// PR4 Task 4.3 — createFoodBookingCampaign: validate the brief, generate windows,
// call generateCampaign with the enabled windows, and persist one ad-set row per
// enabled window with food fields + utm_content from the window key.
// generateCampaign + Supabase + management links are mocked.
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/campaigns/generate', () => ({
  generateCampaign: vi.fn(),
}));

vi.mock('@/lib/meta/marketing', () => ({
  createMetaAd: vi.fn(),
  createMetaAdCreative: vi.fn(),
  searchMetaInterests: vi.fn(),
  uploadMetaImage: vi.fn(),
}));

vi.mock('@/lib/campaigns/optimisation', () => ({
  runMetaCampaignOptimisation: vi.fn(),
}));

vi.mock('@/lib/campaigns/performance-sync', () => ({
  syncMetaCampaignPerformance: vi.fn(),
}));

vi.mock('@/lib/management-app/data', () => ({
  getManagementConnectionConfig: vi.fn(),
}));

vi.mock('@/lib/management-app/client', () => ({
  createManagementMetaAdsLink: vi.fn(),
  ManagementApiError: class ManagementApiError extends Error {
    constructor(public code: string, message: string, public status?: number) {
      super(message);
    }
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/publishing/audit', () => ({
  logPublishAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Force the feature flag on for these tests (the action is gated behind it).
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return { ...actual, featureFlags: { ...actual.featureFlags, foodBooking: true } };
});

import { createFoodBookingCampaign } from '@/app/(app)/campaigns/actions';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { generateCampaign } from '@/lib/campaigns/generate';
import { logPublishAuditEvent } from '@/lib/publishing/audit';
import { revalidatePath } from 'next/cache';
import { DEFAULT_FOOD_SERVICE_HOURS } from '@/lib/campaigns/food-schedule';
import { calculateFoodBookingPhases } from '@/lib/campaigns/food-booking-phases';
import type { FoodBookingBrief } from '@/types/campaigns';

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const insertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
const deleteCalls: Array<{ table: string; column: string; value: unknown }> = [];
let currentTable = '';
// When set, the next `ads` insert resolves with this error so we can exercise the
// cleanup-on-failure path.
let adInsertError: { message: string } | null = null;

function keyMatchesOccurrence(key: string, occurrenceKey: string) {
  return key === occurrenceKey || key.startsWith(`${occurrenceKey}-`);
}
// Tracks whether the immediately-preceding builder call was .delete(), so the following
// .eq() can be recorded as a delete filter.
let lastOpWasDelete = false;

const mockSupabase = {
  from: vi.fn((table: string) => {
    currentTable = table;
    return mockSupabase;
  }),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn((column: string, value: unknown) => {
    // Record campaign-row deletes (the cleanup path: delete().eq('id', campaignId)).
    if (lastOpWasDelete) {
      deleteCalls.push({ table: currentTable, column, value });
      lastOpWasDelete = false;
    }
    return mockSupabase;
  }),
  insert: vi.fn((payload: Record<string, unknown>) => {
    insertCalls.push({ table: currentTable, payload });
    return mockSupabase;
  }),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn(() => {
    lastOpWasDelete = true;
    return mockSupabase;
  }),
  order: vi.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  // Awaited directly by `ads` inserts: `const { error } = await supabase...insert(...)`.
  get error() {
    return currentTable === 'ads' ? adInsertError : null;
  },
};

function brief(over: Partial<FoodBookingBrief> = {}): FoodBookingBrief {
  return {
    services: [DEFAULT_FOOD_SERVICE_HOURS.sunday_roast],
    bookingUrl: 'https://www.the-anchor.pub/book-table',
    serviceBookingUrls: {
      sunday_roast: 'https://www.the-anchor.pub/book-table?service=sunday-roast',
    },
    foodHooks: ['Hand-carved roast', 'Cauliflower cheese'],
    weeks: 1,
    dayWeighting: 'even',
    ...over,
  };
}

function baseInput(over: Record<string, unknown> = {}) {
  return {
    promotionName: 'Sunday Roast Bookings',
    problemBrief: 'Fill the Sunday roast service.',
    brief: brief(),
    budgetAmount: 200,
    budgetType: 'LIFETIME' as const,
    geoRadiusMiles: 3 as const,
    audienceMode: 'local_only' as const,
    startDate: '2026-06-09', // Tuesday — the Friday/Saturday/Sunday roast windows fall in this week
    ...over,
  };
}

/** generateCampaign returns one ad set per phase it is given, echoing food window CTAs as BOOK_NOW. */
function mockGenerateEchoesPhases() {
  vi.mocked(generateCampaign).mockImplementation(async (input) => ({
    objective: 'OUTCOME_SALES',
    rationale: 'Roast push.',
    campaign_name: 'Sunday Roast Bookings',
    special_ad_category: 'NONE',
    audience_keywords: ['sunday roast', 'family lunch'],
    ad_sets: input.phases.map((phase, index) => ({
      name: phase.phaseLabel,
      phase_label: phase.phaseLabel,
      phase_start: phase.phaseStart,
      phase_end: phase.phaseEnd,
      ads_stop_time: phase.adsStopTime ?? undefined,
      audience_description: 'Local diners',
      targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
      placements: 'AUTO',
      optimisation_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      ads: [
        {
          name: `Window ${index + 1} — Var 1`,
          headline: 'Roast table',
          primary_text: 'Book a table for our Sunday roast, served from 1pm.',
          description: 'Reserve now',
          cta: 'BOOK_NOW',
          creative_brief: 'Sunday roast spread',
          angle: 'Booking urgency',
        },
      ],
    })),
  })) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does not flush queued mockResolvedValueOnce entries; reset them so a
  // test that consumes a different number of lookups cannot leak queue items forward.
  mockSingle.mockReset();
  mockMaybeSingle.mockReset();
  insertCalls.length = 0;
  deleteCalls.length = 0;
  currentTable = '';
  adInsertError = null;
  lastOpWasDelete = false;
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
  mockMaybeSingle.mockResolvedValue({ data: null });
  // Sequence of .single() lookups: account display_name, then campaign insert id,
  // then one ad-set insert id per enabled window.
  mockSingle.mockResolvedValue({ data: { id: 'adset-generated' }, error: null });
});

function queuePrerequisites() {
  // meta_ad_accounts check (setup_complete + pixel ready)
  mockMaybeSingle.mockResolvedValueOnce({
    data: {
      setup_complete: true,
      meta_account_id: 'act_123',
      meta_pixel_id: '123456789012345',
      conversion_event_name: 'Purchase',
      conversion_optimisation_enabled: true,
    },
  });
  // accounts.display_name
  mockSingle.mockResolvedValueOnce({ data: { display_name: 'The Anchor' }, error: null });
  // posting_defaults.venue_location
  mockMaybeSingle.mockResolvedValueOnce({ data: { venue_location: 'Stanwell Moor' } });
  // campaign insert → id
  mockSingle.mockResolvedValueOnce({ data: { id: 'campaign-1' }, error: null });
}

describe('createFoodBookingCampaign', () => {
  it('calls calculateFoodBookingPhases and generateCampaign with only enabled windows + food hooks', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    const result = await createFoodBookingCampaign(baseInput());

    expect(result).toHaveProperty('campaignId', 'campaign-1');

    const expectedWindows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const enabled = expectedWindows.filter((w) => w.enabled);
    expect(enabled.length).toBeGreaterThan(0);

    const generateArgs = vi.mocked(generateCampaign).mock.calls[0]![0];
    expect(generateArgs.campaignKind).toBe('food_booking');
    expect(generateArgs.foodHooks).toEqual(['Hand-carved roast', 'Cauliflower cheese']);
    // The brief's own service hours flow into copy generation (CR-3), not the defaults.
    expect(generateArgs.foodServices).toEqual(brief().services);
    // One phase per enabled window, parallel ordering.
    expect(generateArgs.foodWindows).toEqual(enabled);
    expect(generateArgs.phases).toHaveLength(enabled.length);
    expect(generateArgs.phases[0]).toMatchObject({
      phaseStart: enabled[0]!.runDate,
      adsStopTime: enabled[0]!.endsAtLocal,
    });
  });

  it('persists one ad-set row per enabled window with food fields and utm_content from windowKey', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    await createFoodBookingCampaign(baseInput());

    const enabled = calculateFoodBookingPhases(brief(), '2026-06-09').filter((w) => w.enabled);
    const adSetInserts = insertCalls.filter((c) => c.table === 'ad_sets');
    expect(adSetInserts).toHaveLength(enabled.length);

    const firstWindow = enabled[0]!;
    const firstAdSet = adSetInserts[0]!.payload;
    expect(firstAdSet).toMatchObject({
      phase_start: firstWindow.runDate,
      ads_start_time: firstWindow.startsAtLocal,
      ads_stop_time: firstWindow.endsAtLocal,
      service_key: firstWindow.serviceKey,
      decision_stage: firstWindow.decisionStage,
      budget_weight: firstWindow.budgetWeight,
    });

    // Each ad carries a per-ad utm_content key prefixed by windowKey + runDate.
    const adInserts = insertCalls.filter((c) => c.table === 'ads');
    expect(adInserts.length).toBeGreaterThan(0);
    const occurrenceKeys = new Set(enabled.map((w) => `${w.windowKey}-${w.runDate}`));
    for (const ad of adInserts) {
      expect(
        Array.from(occurrenceKeys).some((occurrenceKey) => (
          keyMatchesOccurrence(ad.payload.utm_content_key as string, occurrenceKey)
        )),
      ).toBe(true);
    }
  });

  it('assigns a distinct utm_content_key to every ad across a multi-week multi-window campaign', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    // A 2-week sunday roast brief repeats each windowKey across two run-dates, so the
    // utm_content must include the run-date to stay unique campaign-wide (CR-1).
    await createFoodBookingCampaign(baseInput({ brief: brief({ weeks: 2 }) }));

    const enabled = calculateFoodBookingPhases(brief({ weeks: 2 }), '2026-06-09').filter((w) => w.enabled);
    // Sanity: the same windowKey genuinely repeats across run-dates in this brief.
    expect(new Set(enabled.map((w) => w.windowKey)).size).toBeLessThan(enabled.length);

    const adKeys = insertCalls
      .filter((c) => c.table === 'ads')
      .map((c) => c.payload.utm_content_key as string);
    expect(adKeys.length).toBeGreaterThan(0);
    // Every ad's utm_content is unique across the whole campaign.
    expect(new Set(adKeys).size).toBe(adKeys.length);
    // And each key preserves the windowKey + runDate composite as its attribution prefix.
    const occurrenceKeys = new Set(enabled.map((w) => `${w.windowKey}-${w.runDate}`));
    for (const key of adKeys) {
      expect(Array.from(occurrenceKeys).some((occurrenceKey) => (
        keyMatchesOccurrence(key, occurrenceKey)
      ))).toBe(true);
    }
  });

  it('stores the food schedule, booking URL and conversion flag in source_snapshot', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    await createFoodBookingCampaign(baseInput());

    const campaignInsert = insertCalls.find((c) => c.table === 'meta_campaigns');
    expect(campaignInsert).toBeDefined();
    const snapshot = campaignInsert!.payload.source_snapshot as Record<string, unknown>;
    expect(snapshot.bookingUrl).toBe(brief().bookingUrl);
    expect(snapshot.serviceBookingUrls).toMatchObject({
      sunday_roast: 'https://www.the-anchor.pub/book-table?service=sunday-roast',
    });
    expect(snapshot.bookingConversionOptimised).toBe(true);
    expect(Array.isArray(snapshot.foodSchedule)).toBe(true);
    expect((snapshot.foodSchedule as unknown[]).length).toBeGreaterThan(0);
    expect(campaignInsert!.payload.campaign_kind).toBe('food_booking');
  });

  it('round-trips the full brief and window overrides in source_snapshot (Phase 3)', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    const overrides = { sunday_roast_last_tables: false };
    await createFoodBookingCampaign(baseInput({ windowOverrides: overrides }));

    const campaignInsert = insertCalls.find((c) => c.table === 'meta_campaigns');
    const snapshot = campaignInsert!.payload.source_snapshot as Record<string, unknown>;
    // The original brief is stored verbatim so Phase 3 can re-materialise the schedule.
    expect(snapshot.brief).toEqual(brief());
    expect(snapshot.windowOverrides).toEqual(overrides);
  });

  it('revalidates the campaigns route after creation', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    await createFoodBookingCampaign(baseInput());

    expect(revalidatePath).toHaveBeenCalledWith('/campaigns');
  });

  it('rejects a brief with no enabled services', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    const result = await createFoodBookingCampaign(
      baseInput({ brief: brief({ services: [] }) }),
    );

    expect(result).toHaveProperty('error');
    expect(generateCampaign).not.toHaveBeenCalled();
  });

  it('rejects an invalid booking URL', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    const result = await createFoodBookingCampaign(
      baseInput({ brief: brief({ bookingUrl: 'not-a-url' }) }),
    );

    expect(result).toHaveProperty('error');
    expect(generateCampaign).not.toHaveBeenCalled();
  });

  it('switches a default-off rescue window ON via windowOverrides', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    const weekdayBrief = brief({ services: [DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner] });

    // Baseline: weekday_last_minute is default-off, so no enabled window carries it.
    const defaultEnabled = calculateFoodBookingPhases(weekdayBrief, '2026-06-09').filter((w) => w.enabled);
    expect(defaultEnabled.some((w) => w.windowKey === 'weekday_last_minute')).toBe(false);

    await createFoodBookingCampaign(
      baseInput({ brief: weekdayBrief, windowOverrides: { weekday_last_minute: true } }),
    );

    // The override creates ad sets for the previously-disabled rescue windows.
    const generatedWindows = vi.mocked(generateCampaign).mock.calls[0]![0].foodWindows ?? [];
    expect(generatedWindows.some((w) => w.windowKey === 'weekday_last_minute')).toBe(true);

    const lastMinuteWindow = generatedWindows.find((w) => w.windowKey === 'weekday_last_minute')!;
    const adInserts = insertCalls.filter((c) => c.table === 'ads');
    expect(
      adInserts.some(
        (c) => keyMatchesOccurrence(
          c.payload.utm_content_key as string,
          `weekday_last_minute-${lastMinuteWindow.runDate}`,
        ),
      ),
    ).toBe(true);
  });

  it('switches a default-on window OFF via windowOverrides', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    // Baseline: sunday_roast_last_tables is default-on for the sunday_roast brief.
    const defaultEnabled = calculateFoodBookingPhases(brief(), '2026-06-09').filter((w) => w.enabled);
    expect(defaultEnabled.some((w) => w.windowKey === 'sunday_roast_last_tables')).toBe(true);

    await createFoodBookingCampaign(
      baseInput({ windowOverrides: { sunday_roast_last_tables: false } }),
    );

    const generatedWindows = vi.mocked(generateCampaign).mock.calls[0]![0].foodWindows ?? [];
    expect(generatedWindows.some((w) => w.windowKey === 'sunday_roast_last_tables')).toBe(false);

    const adInserts = insertCalls.filter((c) => c.table === 'ads');
    expect(
      adInserts.some((c) => (c.payload.utm_content_key as string).startsWith('sunday_roast_last_tables-')),
    ).toBe(false);
    // Other default-on roast windows are still created.
    expect(
      adInserts.some((c) => (c.payload.utm_content_key as string).startsWith('sunday_roast_morning-')),
    ).toBe(true);
  });

  it('leaves default window selection unchanged when no overrides are given', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    await createFoodBookingCampaign(baseInput());

    const enabledByDefault = calculateFoodBookingPhases(brief(), '2026-06-09').filter((w) => w.enabled);
    const generatedWindows = vi.mocked(generateCampaign).mock.calls[0]![0].foodWindows ?? [];
    expect(generatedWindows).toEqual(enabledByDefault);
  });

  it('writes a state_transition audit event after a successful create', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    const result = await createFoodBookingCampaign(baseInput());
    expect(result).toHaveProperty('campaignId', 'campaign-1');

    const enabled = calculateFoodBookingPhases(brief(), '2026-06-09').filter((w) => w.enabled);
    expect(logPublishAuditEvent).toHaveBeenCalledTimes(1);
    expect(logPublishAuditEvent).toHaveBeenCalledWith({
      accountId: 'account-123',
      operationType: 'state_transition',
      resourceType: 'content_item',
      resourceId: 'campaign-1',
      details: {
        action: 'create_food_booking_campaign',
        services: ['sunday_roast'],
        weeks: 1,
        windowCount: enabled.length,
      },
    });
  });

  it('does not log an audit event when the create fails', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();

    // No enabled services → early return before any insert.
    const result = await createFoodBookingCampaign(baseInput({ brief: brief({ services: [] }) }));
    expect(result).toHaveProperty('error');
    expect(logPublishAuditEvent).not.toHaveBeenCalled();
  });

  it('deletes the created campaign (cascade) when an ad insert fails, then returns the error', async () => {
    queuePrerequisites();
    mockGenerateEchoesPhases();
    // First ad insert fails after the campaign + ad set rows exist.
    adInsertError = { message: 'ad insert boom' };

    const result = await createFoodBookingCampaign(baseInput());

    expect(result).toEqual({ error: 'ad insert boom' });
    // The partial draft is cleaned up: the campaign row is deleted (cascade removes
    // its ad_sets/ads), so no orphaned DRAFT is left behind.
    expect(deleteCalls).toContainEqual({ table: 'meta_campaigns', column: 'id', value: 'campaign-1' });
    // A failed create must not emit a success audit event.
    expect(logPublishAuditEvent).not.toHaveBeenCalled();
  });
});
