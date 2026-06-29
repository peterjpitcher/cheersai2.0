import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

import type { EventCampaignInput, InstantPostInput, PromotionCampaignInput } from "@/lib/create/schema";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

// --- Hoisted mocks -----------------------------------------------------------
//
// These mocks intercept the auth, settings, OpenAI, scheduling, and publishing
// modules so the create-service tests below can exercise the real DB-write
// path (campaigns → content_items → content_variants) without standing up a
// real Supabase or OpenAI client. The chainable `supabaseMock` builder
// captures the variant upsert payload so we can assert the exact columns
// written for each of the banner-handling cases.
const {
  requireAuthContextMock,
  getOwnerSettingsMock,
  enqueuePublishJobMock,
  deconflictCampaignPlansMock,
  variantUpsertCallsRef,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  getOwnerSettingsMock: vi.fn(),
  enqueuePublishJobMock: vi.fn(),
  deconflictCampaignPlansMock: vi.fn(),
  variantUpsertCallsRef: { calls: [] as Array<unknown[]> },
}));

vi.mock("@/lib/auth/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>(
    "@/lib/auth/server",
  );
  return {
    ...actual,
    requireAuthContext: requireAuthContextMock,
  };
});

vi.mock("@/lib/settings/data", () => ({
  getOwnerSettings: getOwnerSettingsMock,
}));

vi.mock("@/lib/publishing/queue", () => ({
  enqueuePublishJob: enqueuePublishJobMock,
}));

vi.mock("@/lib/scheduling/deconflict", () => ({
  deconflictCampaignPlans: deconflictCampaignPlansMock,
}));

const { __testables } = await import("@/lib/create/service");
const { createInstantPost, createEventCampaign, createPromotionCampaign } = await import(
  "@/lib/create/service"
);

// --- Supabase chain mock builder --------------------------------------------
//
// The service queries multiple tables via a fluent .from(table)... chain. This
// builder returns a thenable per-call object that handles the read paths
// (content_items history, schedule lookups) and the write paths (campaigns,
// content_items, content_variants), capturing the variant upsert payload into
// `variantUpsertCallsRef.calls` for the tests to inspect.
function buildSupabaseMock(): {
  client: { from: (table: string) => unknown };
  variantUpserts: Array<unknown[]>;
} {
  variantUpsertCallsRef.calls = [];
  let contentItemCounter = 0;

  function makeChain(table: string) {
    const state: { lastUpsert?: unknown[] } = {};

    const chain: Record<string, (...args: unknown[]) => unknown> = {};

    // No-op chainable methods that return the same chain
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "gte",
      "lte",
      "order",
      "limit",
      "match",
    ]) {
      chain[method] = () => chain;
    }

    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.single = () => {
      if (table === "campaigns") {
        return Promise.resolve({ data: { id: "cam-test-1" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };

    chain.insert = (rows: unknown) => {
      if (table === "campaigns") {
        // Caller pattern: .insert(row).select("id").single()
        return chain;
      }
      if (table === "content_items") {
        const items = Array.isArray(rows) ? rows : [rows];
        const inserted = items.map((row) => {
          contentItemCounter += 1;
          const platform =
            (row as Record<string, unknown>).platform ?? "facebook";
          return {
            id: `content-${contentItemCounter}`,
            platform,
          };
        });
        // Caller pattern: .insert(rows).select("id, platform")
        const itemsChain: Record<string, unknown> = {
          select: () => Promise.resolve({ data: inserted, error: null }),
        };
        return itemsChain;
      }
      // Default: nothing to capture
      return Promise.resolve({ data: null, error: null });
    };

    chain.upsert = (rows: unknown) => {
      const items = Array.isArray(rows) ? rows : [rows];
      if (table === "content_variants") {
        variantUpsertCallsRef.calls.push(items as unknown[]);
        state.lastUpsert = items as unknown[];
        const inserted = (items as Array<Record<string, unknown>>).map(
          (row, index) => ({
            id: `variant-${index + 1}`,
            content_item_id: row.content_item_id,
          }),
        );
        const upsertChain: Record<string, unknown> = {
          select: () => Promise.resolve({ data: inserted, error: null }),
        };
        return upsertChain;
      }
      return Promise.resolve({ data: null, error: null });
    };

    return chain;
  }

  const client = {
    from: (table: string) => makeChain(table),
  };

  return { client, variantUpserts: variantUpsertCallsRef.calls };
}

function buildBrandFixture() {
  return {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [] as string[],
    bannedTopics: [] as string[],
    bannedPhrases: [] as string[],
    defaultHashtags: [] as string[],
    defaultEmojis: [] as string[],
    instagramSignature: undefined,
    facebookSignature: undefined,
  };
}

function buildPostingFixture() {
  return {
    timezone: "Europe/London",
    facebookLocationId: undefined,
    instagramLocationId: undefined,
    defaultPostingTime: undefined,
    venueLocation: undefined,
    venueLatitude: undefined,
    venueLongitude: undefined,
    notifications: { emailFailures: false, emailTokenExpiring: false },
    bannerDefaults: {
      bannersEnabled: true,
      bannerPosition: "right" as const,
      bannerBg: "#a57626",
      bannerTextColour: "#ffffff",
    },
  };
}

function buildInstantInput(overrides: Partial<InstantPostInput> = {}): InstantPostInput {
  return {
    title: "Test Title",
    prompt: "This is a prompt with enough detail to pass validation.",
    publishMode: "now",
    scheduledFor: undefined,
    platforms: ["facebook"],
    media: [],
    ctaUrl: "https://example.com/book",
    linkInBioUrl: undefined,
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: false,
    includeEmojis: true,
    ctaStyle: "default",
    placement: "feed",
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    ...overrides,
  };
}

describe("finaliseCopy", () => {
  it("uses contextual CTA labels when provided", () => {
    const input = buildInstantInput();

    const result = __testables.finaliseCopyForTest(
      "facebook",
      "Big weekend ahead — live music plus limited cask pours.",
      input,
      { ctaLabel: "Book now" },
    );

    expect(result).toContain("Book now: https://example.com/book");
  });

  it("aligns the Instagram link-in-bio line to the CTA label when provided", () => {
    const input = buildInstantInput({
      platforms: ["instagram"],
      ctaUrl: "https://example.com/book",
      includeHashtags: false,
    });

    const result = __testables.finaliseCopyForTest(
      "instagram",
      "Join us for Sunday lunch this weekend.",
      input,
      { ctaLabel: "Book now" },
    );

    expect(result).toContain("Book now via the link in our bio.");
  });
});

describe("enforceInstagramLength", () => {
  function countWordsExcludingHashtags(value: string) {
    return value
      .split(/\s+/)
      .filter((token) => token.length && !token.startsWith("#")).length;
  }

  it("caps captions while retaining the bio link line and hashtags", () => {
    const longSentence =
      "Join us for wood-fired sharing plates, late-night pours, and cosy corners perfect for catching up with the gang";
    const longBody = Array.from({ length: 8 })
      .map(() => longSentence)
      .join(". ");
    const original = `${longBody}\n${longBody}\nSee the link in our bio for details.\n#cheersai #pubnight #livemusic`;

    const trimmed = __testables.enforceInstagramLengthForTest(original);
    const segments = trimmed.split("\n");
    const hashtags = segments.filter((line) => line.trim().startsWith("#")).join(" ");
    const bodyWithoutHashtags = segments.filter((line) => !line.trim().startsWith("#")).join(" ");

    expect(bodyWithoutHashtags).toContain("See the link in our bio for details.");
    expect(hashtags).toContain("#cheersai");
    expect(countWordsExcludingHashtags(bodyWithoutHashtags)).toBeLessThanOrEqual(80);
    expect(trimmed).not.toMatch(/…/);
  });
});

describe("reserveSlotOnSameDay", () => {
  it("moves to the next 30-minute slot when the requested time is occupied", () => {
    const occupied = new Map<string, Set<number>>([
      ["facebook|2026-01-05", new Set([7 * 60])],
    ]);

    const first = __testables.reserveSlotOnSameDayForTest(
      new Date("2026-01-05T07:00:00.000Z"),
      "facebook",
      occupied,
    );
    const second = __testables.reserveSlotOnSameDayForTest(
      new Date("2026-01-05T07:00:00.000Z"),
      "facebook",
      occupied,
    );

    expect(first.toISOString()).toBe("2026-01-05T07:30:00.000Z");
    expect(second.toISOString()).toBe("2026-01-05T08:00:00.000Z");
  });

  it("allows the same slot on a different channel", () => {
    const occupied = new Map<string, Set<number>>([
      ["facebook|2026-01-05", new Set([7 * 60])],
    ]);

    const instagram = __testables.reserveSlotOnSameDayForTest(
      new Date("2026-01-05T07:00:00.000Z"),
      "instagram",
      occupied,
    );

    expect(instagram.toISOString()).toBe("2026-01-05T07:00:00.000Z");
  });

  it("searches backward when forward slots are exhausted near end of day", () => {
    // 23:00 (minute 1380) and 23:30 (minute 1410) are occupied.
    // Forward search would hit 24:00 (1440 = MINUTES_PER_DAY) and throw.
    // Backward search should find 22:30 (minute 1350).
    const occupied = new Map<string, Set<number>>([
      ["facebook|2026-01-05", new Set([23 * 60, 23 * 60 + 30])],
    ]);

    const result = __testables.reserveSlotOnSameDayForTest(
      new Date("2026-01-05T23:00:00.000Z"),
      "facebook",
      occupied,
    );

    expect(result.toISOString()).toBe("2026-01-05T22:30:00.000Z");
  });
});

describe("describeEventTimingCue", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  // --- Recap / past-event ---

  it("returns recap when scheduled well after the event (>3h)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T23:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("recap");
    expect(result.description.toLowerCase()).toMatch(/recap|highlights|look\s*back|how it went/);
  });

  it("returns underway cue when scheduled during the event window (<=3h after start)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T20:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("underway");
  });

  // --- Imminent (within 3 hours, same calendar day) ---

  it("returns today_imminent when event is 2 hours away on the same day", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T17:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("few hours");
    expect(result.description).toContain("today");
  });

  // --- Imminent, cross-midnight ---

  it("returns today_imminent with weekday wording when event is 2 hours away but next calendar day", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T23:00"),
      at("2026-05-19T01:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("few hours");
    expect(result.description).not.toContain("tonight");
  });

  // --- Same calendar day ---

  it("returns today_morning for same day before 2pm", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T10:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_morning");
    expect(result.description).toContain("today");
  });

  it("returns today_imminent for same day at or after 2pm", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T15:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("today");
  });

  // --- Tomorrow (exactly 1 calendar day) ---

  it("returns tomorrow when event is exactly 1 calendar day ahead", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-19T19:00"),
    );
    expect(result.label).toBe("tomorrow");
    expect(result.description).toContain("tomorrow");
  });

  it("returns tomorrow despite 46 elapsed hours when still 1 calendar day ahead", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T01:00"),
      at("2026-05-19T23:00"),
    );
    expect(result.label).toBe("tomorrow");
    expect(result.description).toContain("tomorrow");
  });

  it("returns tomorrow at late-night post time for next-day event", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T23:30"),
      at("2026-05-19T19:00"),
    );
    expect(result.label).toBe("tomorrow");
    expect(result.description).toContain("tomorrow");
  });

  it("returns tomorrow across week boundary (Sunday to Monday)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-24T23:00"),
      at("2026-05-25T19:00"),
    );
    expect(result.label).toBe("tomorrow");
  });

  it("returns tomorrow across BST spring-forward (28 Mar -> 29 Mar 2026)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-03-28T12:00"),
      at("2026-03-29T14:00"),
    );
    expect(result.label).toBe("tomorrow");
  });

  // --- THE BUG: 2 calendar days must NOT say tomorrow ---

  it("returns building (not tomorrow) for Monday post -> Wednesday event", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-20T19:00"),
    );
    expect(result.label).toBe("building");
    expect(result.description).toContain("this Wednesday");
    expect(result.description).not.toContain("tomorrow");
  });

  // --- Building (2-6 calendar days) ---

  it("returns building for 4 days out", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-22T19:00"),
    );
    expect(result.label).toBe("building");
    expect(result.description).toContain("this Friday");
  });

  it("returns building for 6 days out (Sunday)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-24T14:00"),
    );
    expect(result.label).toBe("building");
    expect(result.description).toContain("this Sunday");
  });

  // --- Early awareness (7+ calendar days) ---

  it("returns early_awareness for 7+ days out", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-25T19:00"),
    );
    expect(result.label).toBe("early_awareness");
    expect(result.description).not.toContain("tomorrow");
    expect(result.description).not.toContain("this ");
  });

  it("returns early_awareness for 10+ days out", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-05T12:00"),
      at("2026-05-15T19:00"),
    );
    expect(result.label).toBe("early_awareness");
  });

  // --- Null scheduledFor ---

  it("returns a valid cue when scheduledFor is null", () => {
    const result = __testables.describeEventTimingCueForTest(
      null,
      at("2026-05-20T19:00"),
    );
    expect(result.description).toBeTruthy();
    expect(result.toneCue).toBeTruthy();
    expect(result.label).toBe("today_imminent");
  });
});

describe("describePromotionTimingCue", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  it("returns immediate-interest wording when scheduledFor is null", () => {
    const result = __testables.describePromotionTimingCueForTest(
      null,
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("immediate interest");
  });

  it("returns ends-today for a morning post on the end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-20T10:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends today");
    expect(result.toLowerCase()).not.toContain("wrap up");
  });

  it("returns ends-tonight for an evening post on the end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-20T20:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tonight");
  });

  it("returns ends-tonight for a late-night post on the end day (23:30)", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-20T23:30"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tonight");
    expect(result.toLowerCase()).not.toContain("wrap up");
  });

  it("returns wrap-up after the effective end of the end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-21T00:01"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("wrap up");
  });

  it("returns ends-tomorrow for 1 calendar day before end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-19T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tomorrow");
  });

  it("returns named end date for 2 calendar days before (no 'two days')", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends on wednesday");
    expect(result.toLowerCase()).not.toContain("two days");
  });

  it("returns named end date for 6 calendar days before", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-14T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends on wednesday");
  });

  it("returns finishes-on for 7+ calendar days before", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-13T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("finishes on wednesday");
  });

  it("handles UK spring-forward weekend as tomorrow", () => {
    // UK clocks spring forward 29 March 2026 at 01:00
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-03-28T12:00"),
      at("2026-03-29T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tomorrow");
  });
});

// --- Bug A: instant-post banner override regression suite -------------------
//
// These tests lock the contract for `createInstantPost` and the shared
// `createCampaignFromPlans` helper:
//
//  - Test 1 + 2: when `createInstantPost` is invoked, the variant insert
//    payload MUST always include an explicit `banner_enabled` (true or
//    false). NULL is no longer acceptable because at publish time NULL means
//    "inherit account default", which silently rendered banners on instant
//    posts the user never opted into.
//
//  - Test 3 (regression guard): the shared `createCampaignFromPlans` helper
//    MUST keep its existing behaviour for callers that do not pass the new
//    instant-only `bannerOverride`. Today's campaign callers omit
//    `bannerDefaults` only when the user did not customise the picker — and
//    they must continue to write NO banner_* columns so account defaults
//    win at publish time. We exercise this through `createEventCampaign`,
//    the cleanest production caller of the shared helper.
//
// All three tests use `placement: "story"` (or `placements: ["story"]` for
// the campaign) so that `buildVariants` short-circuits without an OpenAI
// call — story placements always persist `body: ""`. Stories also bypass
// `resolveScheduleConflicts`, keeping the supabase mock surface small.

function buildBaseInstantInput(
  overrides: Partial<InstantPostInput> = {},
): InstantPostInput {
  return {
    title: "Sunset Story",
    prompt: "",
    publishMode: "now",
    scheduledFor: undefined,
    platforms: ["facebook"],
    media: [
      { assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" },
    ],
    ctaUrl: undefined,
    ctaLabel: undefined,
    linkInBioUrl: undefined,
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: false,
    includeEmojis: false,
    ctaStyle: "default",
    placement: "story",
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    ...overrides,
  } as InstantPostInput;
}

function buildBaseEventInput(
  overrides: Partial<EventCampaignInput> = {},
): EventCampaignInput {
  const startDate = DateTime.now()
    .setZone("Europe/London")
    .plus({ months: 6 })
    .startOf("day")
    .toJSDate();
  return {
    name: "Test Event",
    description: "A regression-guard event used for banner-override testing.",
    startDate,
    startTime: "19:00",
    timezone: "Europe/London",
    prompt: undefined,
    platforms: ["facebook"],
    placements: ["story"],
    heroMedia: [
      { assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" },
    ],
    ctaUrl: undefined,
    ctaLabel: undefined,
    linkInBioUrl: undefined,
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: false,
    includeEmojis: false,
    ctaStyle: "default",
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    scheduleOffsets: [{ label: "Event day", offsetHours: 0 }],
    customSchedule: undefined,
    bannerDefaults: undefined,
    ...overrides,
  } as EventCampaignInput;
}

describe("createInstantPost — banner override (Bug A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mock = buildSupabaseMock();
    requireAuthContextMock.mockResolvedValue({
      supabase: mock.client,
      accountId: "acc-test-1",
      user: { id: "user-test-1", email: "test@example.com" },
    });
    getOwnerSettingsMock.mockResolvedValue({
      brand: buildBrandFixture(),
      posting: buildPostingFixture(),
      venueName: "The Anchor",
      venueLocation: "Stanwell Moor",
    });
    enqueuePublishJobMock.mockResolvedValue(undefined);
    deconflictCampaignPlansMock.mockImplementation(
      async (
        _supabase: unknown,
        _accountId: unknown,
        plans: unknown,
      ) => plans,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes banner_enabled=false explicitly when input.banner is undefined", async () => {
    const input = buildBaseInstantInput({ banner: undefined });

    await createInstantPost(input);

    expect(variantUpsertCallsRef.calls.length).toBeGreaterThan(0);
    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(variantPayload).toBeDefined();
    // Bug A guard: must be an explicit false, not null and not absent.
    expect(variantPayload).toHaveProperty("banner_enabled", false);
  });

  it("writes banner_enabled=false explicitly when input.banner.enabled is false", async () => {
    const input = buildBaseInstantInput({ banner: { enabled: false } });

    await createInstantPost(input);

    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(variantPayload).toBeDefined();
    expect(variantPayload).toHaveProperty("banner_enabled", false);
  });

  it("writes banner_enabled=true plus the picker colours and position when banner.enabled is true", async () => {
    const input = buildBaseInstantInput({
      banner: {
        enabled: true,
        defaults: {
          position: "right",
          bgColour: "gold",
          textColour: "white",
        },
      },
    });

    await createInstantPost(input);

    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(variantPayload).toBeDefined();
    // BANNER_COLOUR_HEX maps gold → #a57626 and white → #ffffff. Compare in
    // a case-insensitive manner because the brief quotes #FFFFFF (upper case)
    // while the source map uses the lower-case #ffffff form.
    expect(variantPayload).toMatchObject({
      banner_enabled: true,
      banner_position: "right",
      banner_bg: "#a57626",
    });
    const textColour = String(variantPayload?.banner_text_colour ?? "");
    expect(textColour.toLowerCase()).toBe("#ffffff");
  });

  it("writes the editable overlay text when instant banner text is set", async () => {
    const input = buildBaseInstantInput({
      banner: {
        enabled: true,
        defaults: {
          position: "right",
          bgColour: "gold",
          textColour: "white",
          customMessage: "tonight",
        },
      },
    });

    await createInstantPost(input);

    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(variantPayload).toBeDefined();
    expect(variantPayload).toMatchObject({
      banner_enabled: true,
      banner_text_override: "TONIGHT",
    });
  });
});

describe("createCampaignFromPlans — campaign caller regression guard (Bug A, test 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mock = buildSupabaseMock();
    requireAuthContextMock.mockResolvedValue({
      supabase: mock.client,
      accountId: "acc-test-1",
      user: { id: "user-test-1", email: "test@example.com" },
    });
    getOwnerSettingsMock.mockResolvedValue({
      brand: buildBrandFixture(),
      posting: buildPostingFixture(),
      venueName: "The Anchor",
      venueLocation: "Stanwell Moor",
    });
    enqueuePublishJobMock.mockResolvedValue(undefined);
    deconflictCampaignPlansMock.mockImplementation(
      async (
        _supabase: unknown,
        _accountId: unknown,
        plans: unknown,
      ) => plans,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes NO banner_enabled column for campaign callers that omit bannerDefaults", async () => {
    // Today's campaign caller: `bannerDefaults` undefined → variant payload
    // must contain none of the banner_* columns so the publish-queue worker
    // resolves them from the account default (banners_enabled=true today).
    // This is the exact behaviour the Backend Implementer in Wave 2 must
    // preserve when they add the new `bannerOverride` parameter.
    const input = buildBaseEventInput({ bannerDefaults: undefined });

    await createEventCampaign(input);

    expect(variantUpsertCallsRef.calls.length).toBeGreaterThan(0);
    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(variantPayload).toBeDefined();
    // The critical assertion: no banner_enabled key whatsoever.
    expect(variantPayload).not.toHaveProperty("banner_enabled");
    expect(variantPayload).not.toHaveProperty("banner_position");
    expect(variantPayload).not.toHaveProperty("banner_bg");
    expect(variantPayload).not.toHaveProperty("banner_text_colour");
  });
});

function buildBasePromotionInput(
  overrides: Partial<PromotionCampaignInput> = {},
): PromotionCampaignInput {
  const TZ = "Europe/London";
  const startDate = DateTime.fromISO("2026-05-15T00:00", { zone: TZ }).toJSDate();
  const endDate = DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate();
  return {
    name: "Happy Hour",
    offerSummary: "2-for-1 cocktails all week",
    startDate,
    endDate,
    dateMode: "ends_on",
    prompt: undefined,
    platforms: ["facebook"],
    placements: ["story"],
    heroMedia: [
      { assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" },
    ],
    ctaUrl: undefined,
    ctaLabel: undefined,
    linkInBioUrl: undefined,
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: "default",
    customSchedule: undefined,
    bannerDefaults: undefined,
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    ...overrides,
  } as PromotionCampaignInput;
}

describe("createPromotionCampaign — phase date regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
    vi.clearAllMocks();
    const mock = buildSupabaseMock();
    requireAuthContextMock.mockResolvedValue({
      supabase: mock.client,
      accountId: "acc-test-1",
      user: { id: "user-test-1", email: "test@example.com" },
    });
    getOwnerSettingsMock.mockResolvedValue({
      brand: buildBrandFixture(),
      posting: buildPostingFixture(),
      venueName: "The Anchor",
      venueLocation: "Stanwell Moor",
    });
    enqueuePublishJobMock.mockResolvedValue(undefined);
    deconflictCampaignPlansMock.mockImplementation(
      async (_supabase: unknown, _accountId: unknown, plans: unknown) => plans,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("preserves raw end date in promptContext.promotionEnd (not effectiveEnd)", async () => {
    const TZ = "Europe/London";
    const endDate = DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate();
    const input = buildBasePromotionInput({
      startDate: DateTime.fromISO("2026-05-15T00:00", { zone: TZ }).toJSDate(),
      endDate,
    });

    await createPromotionCampaign(input);

    expect(variantUpsertCallsRef.calls.length).toBeGreaterThan(0);
    const allPayloads = variantUpsertCallsRef.calls.flat() as Array<Record<string, unknown>>;
    for (const payload of allPayloads) {
      const ctx = payload?.prompt_context as Record<string, unknown> | undefined;
      if (ctx?.promotionEnd) {
        expect(ctx.promotionEnd).toBe(endDate.toISOString());
      }
    }
  });
});

// --- Wave 2: Deconfliction drift tests --------------------------------------

describe("replaceGeneratedFocusLine", () => {
  it("replaces the last Focus: line in the prompt", () => {
    const prompt = [
      "Event name: Quiz Night",
      "",
      "Focus: 2 days to go. Say it's tomorrow (Wednesday 20 May).",
    ].join("\n");
    const newFocusLine = "Focus: 2 days to go. Refer to it as this Wednesday (20 May).";

    const result = __testables.replaceGeneratedFocusLineForTest(prompt, newFocusLine);

    expect(result).toContain(newFocusLine);
    expect(result).not.toContain("Say it's tomorrow");
  });

  it("preserves user Focus: text and replaces only the last generated one", () => {
    const prompt = [
      "Focus: Make sure to mention the DJ.",
      "",
      "Event name: Live Music Night",
      "",
      "Focus: Event day. Share live highlights.",
    ].join("\n");
    const newFocusLine = "Focus: Event day. Call out it's happening today.";

    const result = __testables.replaceGeneratedFocusLineForTest(prompt, newFocusLine);

    expect(result).toContain("Focus: Make sure to mention the DJ.");
    expect(result).toContain(newFocusLine);
    expect(result).not.toContain("Share live highlights");
  });

  it("appends the focus line when none exists in the prompt", () => {
    const prompt = "Event name: Quiz Night\n\nSome base prompt text.";
    const newFocusLine = "Focus: 1 week to go. Build anticipation.";

    const result = __testables.replaceGeneratedFocusLineForTest(prompt, newFocusLine);

    expect(result).toContain("Event name: Quiz Night");
    expect(result).toContain(newFocusLine);
  });
});

describe("refreshTimingForPlan", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  function buildEventPlanWithTiming(overrides: Record<string, unknown> = {}) {
    return {
      title: "Quiz Night — 2 days to go",
      prompt: [
        "Event name: Quiz Night",
        "",
        "Focus: 2 days to go. Say it's tomorrow (Wednesday 20 May) and stress limited spots before 7:00 pm.",
      ].join("\n"),
      scheduledFor: at("2026-05-19T12:00"),
      platforms: ["facebook"] as ("facebook" | "instagram")[],
      media: [],
      promptContext: {
        useCase: "event",
        temporalProximity: "anticipation, countdown, don't miss out",
        timingLabel: "tomorrow",
        eventStart: at("2026-05-20T19:00").toISOString(),
      },
      placement: "feed" as const,
      planIndex: 0,
      timing: {
        kind: "event" as const,
        focusLabel: "2 days to go",
        eventStart: at("2026-05-20T19:00"),
      },
      ...overrides,
    };
  }

  it("refreshes event timing when shifted earlier (Tue→Mon, event Wed)", () => {
    const plan = buildEventPlanWithTiming({
      scheduledFor: at("2026-05-18T12:00"),
    });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).not.toContain("tomorrow");
    expect(result.prompt.toLowerCase()).toContain("wednesday");
    expect(result.promptContext?.timingLabel).toBe("building");
  });

  it("refreshes event timing when shifted later (Mon→Tue, event Wed)", () => {
    const plan = buildEventPlanWithTiming({
      scheduledFor: at("2026-05-19T12:00"),
    });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).toContain("tomorrow");
    expect(result.promptContext?.timingLabel).toBe("tomorrow");
  });

  it("returns unchanged plan when timing already matches", () => {
    const plan = buildEventPlanWithTiming();

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.promptContext?.timingLabel).toBe("tomorrow");
  });

  it("returns unchanged plan when no timing metadata", () => {
    const plan = buildEventPlanWithTiming({ timing: undefined });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt).toBe(plan.prompt);
    expect(result.promptContext).toEqual(plan.promptContext);
  });

  it("returns unchanged plan when scheduledFor is null", () => {
    const plan = buildEventPlanWithTiming({ scheduledFor: null });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt).toBe(plan.prompt);
  });

  it("refreshes promotion timing when shifted onto the end day", () => {
    const plan = {
      title: "Happy Hour — Last chance",
      prompt: [
        "Promotion: Happy Hour",
        "",
        "Focus: Last chance. Stress that it ends tomorrow (Wednesday 20 May).",
      ].join("\n"),
      scheduledFor: at("2026-05-20T10:00"),
      platforms: ["facebook"] as ("facebook" | "instagram")[],
      media: [],
      promptContext: {
        useCase: "promotion",
        promotionEnd: at("2026-05-20T00:00").toISOString(),
        promotionDateMode: "ends_on",
      },
      placement: "feed" as const,
      planIndex: 0,
      timing: {
        kind: "promotion" as const,
        focusLabel: "Last chance",
        promotionEnd: at("2026-05-20T00:00"),
        promotionDateMode: "ends_on" as const,
      },
    };

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).toContain("ends today");
  });

  it("refreshes promotion timing when shifted past end day", () => {
    const plan = {
      title: "Happy Hour — Last chance",
      prompt: [
        "Promotion: Happy Hour",
        "",
        "Focus: Last chance. Stress that it ends tomorrow (Wednesday 20 May).",
      ].join("\n"),
      scheduledFor: at("2026-05-21T10:00"),
      platforms: ["facebook"] as ("facebook" | "instagram")[],
      media: [],
      promptContext: {
        useCase: "promotion",
        promotionEnd: at("2026-05-20T00:00").toISOString(),
        promotionDateMode: "ends_on",
      },
      placement: "feed" as const,
      planIndex: 0,
      timing: {
        kind: "promotion" as const,
        focusLabel: "Last chance",
        promotionEnd: at("2026-05-20T00:00"),
        promotionDateMode: "ends_on" as const,
      },
    };

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).toContain("wrap up");
  });
});

describe("createEventCampaign — post-deconfliction timing refresh", () => {
  let contentItemInserts: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    vi.clearAllMocks();
    contentItemInserts = [];

    const baseMock = buildSupabaseMock();

    const patchedClient = {
      from: (table: string) => {
        const chain = baseMock.client.from(table);
        if (table === "content_items") {
          const origInsert = (chain as Record<string, (...args: unknown[]) => unknown>).insert;
          (chain as Record<string, unknown>).insert = (rows: unknown) => {
            const items = Array.isArray(rows) ? rows : [rows];
            contentItemInserts.push(...(items as Array<Record<string, unknown>>));
            return origInsert(rows);
          };
        }
        return chain;
      },
    };

    requireAuthContextMock.mockResolvedValue({
      supabase: patchedClient,
      accountId: "acc-test-1",
      user: { id: "user-test-1", email: "test@example.com" },
    });
    getOwnerSettingsMock.mockResolvedValue({
      brand: buildBrandFixture(),
      posting: buildPostingFixture(),
      venueName: "The Anchor",
      venueLocation: "Stanwell Moor",
    });
    enqueuePublishJobMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("updates promptContext.timingLabel when deconfliction shifts a plan earlier", async () => {
    const TZ = "Europe/London";
    // Event is Wednesday 20 May 2026 at 19:00.
    // Plan originally scheduled for Tuesday 19 May (= "tomorrow").
    // Deconfliction shifts it to Monday 18 May (= "building").
    deconflictCampaignPlansMock.mockImplementation(
      async (_supabase: unknown, _accountId: unknown, plans: unknown) => {
        return (plans as Array<Record<string, unknown>>).map((plan) => {
          const scheduledFor = plan.scheduledFor as Date | null;
          if (!scheduledFor) return plan;
          const shifted = new Date(scheduledFor.getTime() - 24 * 60 * 60 * 1000);
          return { ...plan, scheduledFor: shifted };
        });
      },
    );

    const input = buildBaseEventInput({
      startDate: DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate(),
      startTime: "19:00",
      placements: ["story"],
      scheduleOffsets: [{ label: "1 day to go", offsetHours: -24 }],
    });

    await createEventCampaign(input);

    expect(contentItemInserts.length).toBeGreaterThan(0);
    const ctx = contentItemInserts[0]?.prompt_context as Record<string, unknown> | undefined;
    // After shift: Mon 18 May → Wed 20 May = 2 calendar days = "building"
    expect(ctx?.timingLabel).toBe("building");
  });
});
