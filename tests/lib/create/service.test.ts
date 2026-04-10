import { describe, expect, it } from "vitest";

import type { InstantPostInput } from "@/lib/create/schema";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

const { __testables } = await import("@/lib/create/service");

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
    // This is well past any reasonable event duration, so it should be a recap.
    const eventStart = new Date("2026-01-05T12:00:00.000Z");
    const scheduledFor = new Date("2026-01-05T18:00:00.000Z");

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    // Should NOT say "event is underway" — it should indicate a recap
    expect(result).not.toContain("underway");
    expect(result.toLowerCase()).toMatch(/recap|highlights|look\s*back|how it went/);
  });

  it("still returns underway cue when scheduled during the event window", () => {
    // Event starts at 12:00, post scheduled at 13:00 (1 hour into event).
    const eventStart = new Date("2026-01-05T12:00:00.000Z");
    const scheduledFor = new Date("2026-01-05T13:00:00.000Z");

    const result = __testables.describeEventTimingCueForTest(scheduledFor, eventStart);

    expect(result).toContain("underway");
  });
});
