import { describe, expect, it } from "vitest";

import { buildWeeklyCopy, clampDay, getFirstOccurrenceAfter, type WeeklyAdvancedOptions } from "../supabase/functions/materialise-weekly/utils";

describe("materialise-weekly utils", () => {
  describe("clampDay", () => {
    it("clamps negative to zero", () => {
      expect(clampDay(-3)).toBe(0);
    });

    it("clamps above six to six", () => {
      expect(clampDay(9)).toBe(6);
    });

    it("passes through valid values", () => {
      expect(clampDay(4)).toBe(4);
    });

    it("defaults NaN to zero", () => {
      expect(clampDay(Number.NaN)).toBe(0);
    });
  });

  describe("getFirstOccurrenceAfter", () => {
    it("returns next slot on requested weekday when start is in future", () => {
      const start = new Date(2025, 1, 3, 10, 0, 0); // Monday local time
      const now = new Date(2025, 0, 31, 9, 0, 0);
      const result = getFirstOccurrenceAfter(start, 3, "18:30", now); // Wednesday
      expect(result.getDay()).toBe(3);
      expect(result.getHours()).toBe(18);
      expect(result.getMinutes()).toBe(30);
    });

    it("skips ahead a full week when first slot already passed", () => {
      const start = new Date(2025, 1, 3, 19, 0, 0); // Monday 7pm local
      const now = new Date(2025, 1, 11, 20, 0, 0); // Tuesday following week 8pm
      const result = getFirstOccurrenceAfter(start, 2, "19:00", now); // Tuesday 7pm
      expect(result.getDay()).toBe(2); // Tuesday
      expect(result.getHours()).toBe(19);
      expect(result.getTime()).toBeGreaterThan(now.getTime());
      expect(result.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    });

    it("defaults to 19:00 when provided time is invalid", () => {
      const start = new Date(2025, 1, 3, 0, 0, 0);
      const now = new Date(2025, 0, 31, 0, 0, 0);
      const result = getFirstOccurrenceAfter(start, 5, "", now);
      expect(result.getHours()).toBe(19);
      expect(result.getMinutes()).toBe(0);
    });
  });

  describe("buildWeeklyCopy", () => {
    const date = new Date("2025-02-07T18:00:00Z");

    it("adds instagram-specific hashtags", () => {
      const copy = buildWeeklyCopy("Wine Club", "Join us for a tasting.", date, "instagram");
      expect(copy).toMatch(/#cheersai #weeklyspecial$/);
      expect(copy.toLowerCase()).not.toContain("link in our bio");
    });

    it("adds GBP call to action", () => {
      const copy = buildWeeklyCopy("Wine Club", "Join us for a tasting.", date, "gbp");
      expect(copy).toContain("Tap to learn more");
    });

    it("falls back to house CTA for Facebook", () => {
      const copy = buildWeeklyCopy("Wine Club", "Join us for a tasting.", date, "facebook");
      expect(copy).toContain("Book your table now!");
    });

    it("respects advanced toggles", () => {
      const options: WeeklyAdvancedOptions = {
        toneAdjust: "more_formal",
        lengthPreference: "short",
        includeHashtags: false,
        includeEmojis: false,
        ctaStyle: "direct",
      };
      const copy = buildWeeklyCopy("Wine Club", "Join us for a tasting.", date, "facebook", options);
      expect(copy).toContain("We look forward to hosting you.");
      expect(copy).not.toMatch(/#cheersai/);
      expect(copy).not.toContain("🎉");
      expect(copy).toContain("Book now to lock in your spot.");
    });
  });
});
