import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

import type { EventCampaignInput, InstantPostInput } from "@/lib/create/schema";

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
const { createInstantPost, createEventCampaign } = await import(
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
    gbpCta: "LEARN_MORE",
  };
}

function buildPostingFixture() {
  return {
    timezone: "Europe/London",
    facebookLocationId: undefined,
    instagramLocationId: undefined,
    gbpLocationId: undefined,
    defaultPostingTime: undefined,
    venueLocation: undefined,
    venueLatitude: undefined,
    venueLongitude: undefined,
    notifications: { emailFailures: false, emailTokenExpiring: false },
    gbpCtaDefaults: {
      standard: "LEARN_MORE" as const,
      event: "LEARN_MORE" as const,
      offer: "LEARN_MORE" as const,
    },
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
  it("returns a recap-oriented cue when scheduled well after the event", () => {
    // Event starts at 12:00, post scheduled at 18:00 (6 hours later).
    const eventStart = new Date("2026-01-05T12:00:00.000Z");
    const scheduledFor = new Date("2026-01-05T18:00:00.000Z");

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result.description).not.toContain("underway");
    expect(result.description.toLowerCase()).toMatch(/recap|highlights|look\s*back|how it went/);
    expect(result.label).toBe("recap");
    expect(result.toneCue).toBeTruthy();
  });

  it("still returns underway cue when scheduled during the event window", () => {
    // Event starts at 12:00, post scheduled at 13:00 (1 hour into event).
    const eventStart = new Date("2026-01-05T12:00:00.000Z");
    const scheduledFor = new Date("2026-01-05T13:00:00.000Z");

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result.description).toContain("underway");
    expect(result.label).toBe("today_imminent");
  });

  it("returns early_awareness for 7+ days out", () => {
    const eventStart = new Date("2026-01-15T19:00:00.000Z");
    const scheduledFor = new Date("2026-01-05T12:00:00.000Z"); // 10 days before

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result.label).toBe("early_awareness");
    expect(result.toneCue).toContain("awareness");
  });

  it("returns building for 3-6 days out", () => {
    const eventStart = new Date("2026-01-10T19:00:00.000Z");
    const scheduledFor = new Date("2026-01-06T12:00:00.000Z"); // 4 days before

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result.label).toBe("building");
    expect(result.toneCue).toContain("building");
  });

  it("returns tomorrow for 1-2 days out", () => {
    const eventStart = new Date("2026-01-07T19:00:00.000Z");
    const scheduledFor = new Date("2026-01-06T12:00:00.000Z"); // 1 day before

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result.label).toBe("tomorrow");
    expect(result.toneCue).toContain("countdown");
  });

  it("returns today_morning for same day before 2pm", () => {
    // Event at 7pm, post at 10am same day (in London timezone)
    const eventStart = new Date("2026-01-05T19:00:00.000Z");
    const scheduledFor = new Date("2026-01-05T10:00:00.000Z");

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result.label).toBe("today_morning");
  });

  it("returns today_imminent for same day after 2pm", () => {
    // Event at 7pm, post at 3pm same day (in London timezone)
    const eventStart = new Date("2026-01-05T19:00:00.000Z");
    const scheduledFor = new Date("2026-01-05T15:00:00.000Z");

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result.label).toBe("today_imminent");
  });

  it("returns null-safe cue when scheduledFor is null", () => {
    const eventStart = new Date("2026-01-05T19:00:00.000Z");

    const result = __testables.describeEventTimingCueForTest(null, eventStart);

    expect(result.description).toBeTruthy();
    expect(result.toneCue).toBeTruthy();
    expect(result.label).toBeTruthy();
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
