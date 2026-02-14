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
      ["2026-01-05", new Set([7 * 60])],
    ]);

    const first = __testables.reserveSlotOnSameDayForTest(
      new Date("2026-01-05T07:00:00.000Z"),
      occupied,
    );
    const second = __testables.reserveSlotOnSameDayForTest(
      new Date("2026-01-05T07:00:00.000Z"),
      occupied,
    );

    expect(first.toISOString()).toBe("2026-01-05T07:30:00.000Z");
    expect(second.toISOString()).toBe("2026-01-05T08:00:00.000Z");
  });
});
