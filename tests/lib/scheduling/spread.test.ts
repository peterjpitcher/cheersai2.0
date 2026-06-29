import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  buildSpreadEvenlySlots,
  calendarDayDiff,
  type SpreadConfig,
} from "@/lib/scheduling/spread";

// Helper: create a Date at midnight local time
function makeDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

// Helper: extract local YYYY-MM-DD from a Date (avoids UTC shift from toISOString)
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Monday 2026-04-13 through Sunday 2026-04-19 (one full week)
const WEEK_START = makeDate(2026, 4, 13); // Monday
const WEEK_END = makeDate(2026, 4, 19); // Sunday

// Two full weeks: 2026-04-13 to 2026-04-26
const TWO_WEEK_START = makeDate(2026, 4, 13);
const TWO_WEEK_END = makeDate(2026, 4, 26);

describe("buildSpreadEvenlySlots", () => {
  describe("empty calendar", () => {
    it("distributes 2 posts across 2 different days with 2 platforms and stagger=true", () => {
      const config: SpreadConfig = {
        postsPerWeek: 2,
        platforms: ["instagram", "facebook"],
        staggerPlatforms: true,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      const slots = buildSpreadEvenlySlots(config, []);

      // Should have 2 slots (one per platform per week)
      expect(slots).toHaveLength(2);

      // Each platform should appear exactly once
      const platforms = slots.map((s) => s.platform);
      expect(platforms).toContain("instagram");
      expect(platforms).toContain("facebook");

      // All on different days
      const days = slots.map((s) => toLocalDateStr(s.date));
      const uniqueDays = new Set(days);
      expect(uniqueDays.size).toBe(2);
    });

    it("places 1 post/week on one day when stagger=false", () => {
      const config: SpreadConfig = {
        postsPerWeek: 1,
        platforms: ["instagram", "facebook"],
        staggerPlatforms: false,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      const slots = buildSpreadEvenlySlots(config, []);

      // 1 post/week means 1 slot set; with 2 platforms on same day = 2 slots
      expect(slots).toHaveLength(2);

      // Both on the same day
      const days = slots.map((s) => toLocalDateStr(s.date));
      expect(days[0]).toBe(days[1]);
    });
  });

  describe("partially filled calendar", () => {
    it("fills gaps around existing posts", () => {
      const config: SpreadConfig = {
        postsPerWeek: 2,
        platforms: ["instagram"],
        staggerPlatforms: false,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      // Existing post on Monday (day 0 of the week)
      const existing = [
        { scheduledFor: makeDate(2026, 4, 13), platform: "instagram", placement: "feed" },
      ];

      const slots = buildSpreadEvenlySlots(config, existing);

      expect(slots).toHaveLength(2);

      // Neither slot should be on Monday (2026-04-13) since it's already occupied
      const slotDays = slots.map((s) => toLocalDateStr(s.date));
      // The algorithm should prefer emptier days
      for (const day of slotDays) {
        expect(day).not.toBe("2026-04-13");
      }
    });
  });

  describe("all 7 days occupied", () => {
    it("doubles up on the least busy day", () => {
      const config: SpreadConfig = {
        postsPerWeek: 1,
        platforms: ["instagram"],
        staggerPlatforms: false,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      // All 7 days have a post, but Tuesday has only 1 (others have 2)
      const existing = [];
      for (let d = 13; d <= 19; d++) {
        existing.push({
          scheduledFor: makeDate(2026, 4, d),
          platform: "instagram",
          placement: "feed",
        });
        // Add a second post for all days except Tuesday (14th)
        if (d !== 14) {
          existing.push({
            scheduledFor: makeDate(2026, 4, d),
            platform: "instagram",
            placement: "feed",
          });
        }
      }

      const slots = buildSpreadEvenlySlots(config, existing);

      expect(slots).toHaveLength(1);
      // Should pick Tuesday (least busy with only 1 post)
      expect(toLocalDateStr(slots[0]!.date)).toBe("2026-04-14");
    });
  });

  describe("1-day window", () => {
    it("places the post on that day regardless of occupancy", () => {
      const singleDay = makeDate(2026, 4, 15); // Wednesday
      const config: SpreadConfig = {
        postsPerWeek: 1,
        platforms: ["facebook"],
        staggerPlatforms: false,
        windowStart: singleDay,
        windowEnd: singleDay,
      };

      const existing = [
        { scheduledFor: singleDay, platform: "facebook", placement: "feed" },
      ];

      const slots = buildSpreadEvenlySlots(config, existing);

      expect(slots).toHaveLength(1);
      expect(toLocalDateStr(slots[0]!.date)).toBe("2026-04-15");
    });
  });

  describe("platform staggering edge cases", () => {
    it("groups 2 platforms on same day when only 1 empty day", () => {
      const config: SpreadConfig = {
        postsPerWeek: 2,
        platforms: ["instagram", "facebook"],
        staggerPlatforms: true,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      // Fill 6 of 7 days, leaving only Wednesday (15th) empty
      const existing = [];
      for (let d = 13; d <= 19; d++) {
        if (d === 15) continue; // Leave Wednesday empty
        existing.push({
          scheduledFor: makeDate(2026, 4, d),
          platform: "instagram",
          placement: "feed",
        });
      }

      const slots = buildSpreadEvenlySlots(config, existing);

      expect(slots).toHaveLength(2);

      // Instagram should get the empty day (Wednesday); the other shares a least-busy day
      const instagramSlot = slots.find((s) => s.platform === "instagram");
      expect(instagramSlot).toBeDefined();
      expect(toLocalDateStr(instagramSlot!.date)).toBe("2026-04-15");
    });

    it("groups extra platforms onto least-busy day when empty days run out", () => {
      // 2 platforms, stagger=true, but only 1 truly empty day (Wednesday).
      // After Instagram takes Wednesday, Facebook should land on
      // the least-busy already-assigned day (Wednesday), not the busiest.
      const config: SpreadConfig = {
        postsPerWeek: 2,
        platforms: ["instagram", "facebook"],
        staggerPlatforms: true,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      // Fill 6 of 7 days with 2 posts each, leave only Wednesday (15th) empty
      const existing = [];
      for (let d = 13; d <= 19; d++) {
        if (d === 15) continue;
        existing.push({
          scheduledFor: makeDate(2026, 4, d),
          platform: "instagram",
          placement: "feed",
        });
        existing.push({
          scheduledFor: makeDate(2026, 4, d),
          platform: "facebook",
          placement: "feed",
        });
      }

      const slots = buildSpreadEvenlySlots(config, existing);

      // Both platforms must be present (none dropped)
      expect(slots).toHaveLength(2);
      const platforms = slots.map((s) => s.platform);
      expect(platforms).toContain("instagram");
      expect(platforms).toContain("facebook");

      // Instagram gets the empty day (Wednesday). When dayIndex exceeds
      // available days, remaining platforms should land on the LEAST busy
      // day (which is now Wednesday with just 1 post), not some random busy day.
      const instagramSlot = slots.find((s) => s.platform === "instagram");
      const facebookSlot = slots.find((s) => s.platform === "facebook");

      expect(toLocalDateStr(instagramSlot!.date)).toBe("2026-04-15");
      // Facebook should land on Wednesday too (now least-busy with 1 post)
      // — but NOT on a day with 2 posts when Wednesday has only 1
      expect(toLocalDateStr(facebookSlot!.date)).toBe("2026-04-15");
    });

    it("assigns all platforms to same day when stagger=false", () => {
      const config: SpreadConfig = {
        postsPerWeek: 1,
        platforms: ["instagram", "facebook"],
        staggerPlatforms: false,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      const slots = buildSpreadEvenlySlots(config, []);

      expect(slots).toHaveLength(2);

      // All on the same day
      const days = new Set(slots.map((s) => toLocalDateStr(s.date)));
      expect(days.size).toBe(1);
    });
  });

  describe("multi-week window", () => {
    it("distributes posts across both weeks", () => {
      const config: SpreadConfig = {
        postsPerWeek: 2,
        platforms: ["instagram"],
        staggerPlatforms: false,
        windowStart: TWO_WEEK_START,
        windowEnd: TWO_WEEK_END,
      };

      const slots = buildSpreadEvenlySlots(config, []);

      // 2 posts/week * 2 weeks = 4 slots
      expect(slots).toHaveLength(4);

      // Should span both weeks
      const week1Slots = slots.filter(
        (s) => s.date >= TWO_WEEK_START && s.date < makeDate(2026, 4, 20),
      );
      const week2Slots = slots.filter(
        (s) => s.date >= makeDate(2026, 4, 20),
      );
      expect(week1Slots.length).toBe(2);
      expect(week2Slots.length).toBe(2);
    });
  });

  describe("platform priority order", () => {
    it("assigns Instagram first, then Facebook when staggering", () => {
      const config: SpreadConfig = {
        postsPerWeek: 2,
        platforms: ["facebook", "instagram"], // Intentionally disordered
        staggerPlatforms: true,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      const slots = buildSpreadEvenlySlots(config, []);

      expect(slots).toHaveLength(2);

      // Instagram should get the first (emptiest) day
      const instagramSlot = slots.find((s) => s.platform === "instagram");
      const facebookSlot = slots.find((s) => s.platform === "facebook");

      expect(instagramSlot).toBeDefined();
      expect(facebookSlot).toBeDefined();

      // Instagram should be on the earliest/emptiest day
      expect(instagramSlot!.date.getTime()).toBeLessThanOrEqual(facebookSlot!.date.getTime());
    });
  });

  describe("DST timezone correctness", () => {
    it("assigns a London-midnight date to the correct calendar day (not UTC day)", () => {
      // 2026-04-01 00:00 London time = 2026-03-31T23:00:00Z (BST, UTC+1)
      // A naive Date.getDay() in UTC would see March 31 (Tuesday),
      // but in London it's April 1 (Wednesday).
      const londonMidnightApril1 = new Date("2026-03-31T23:00:00Z"); // midnight BST

      const config: SpreadConfig = {
        postsPerWeek: 1,
        platforms: ["instagram"],
        staggerPlatforms: false,
        windowStart: londonMidnightApril1,
        windowEnd: londonMidnightApril1,
        timezone: "Europe/London",
      };

      const slots = buildSpreadEvenlySlots(config, []);

      expect(slots).toHaveLength(1);
      // In Europe/London, this is 2026-04-01 (Wednesday), not 2026-03-31 (Tuesday)
      const slotDt = slots[0]!.date;
      // Verify by converting back to London time
      const londonDate = DateTime.fromJSDate(slotDt, { zone: "Europe/London" });
      expect(londonDate.day).toBe(1);
      expect(londonDate.month).toBe(4);
      expect(londonDate.year).toBe(2026);
      // Wednesday = weekday 3 in Luxon (1=Mon)
      expect(londonDate.weekday).toBe(3);
    });
  });

  describe("stories are excluded from occupancy", () => {
    it("ignores story placements in existing posts", () => {
      const config: SpreadConfig = {
        postsPerWeek: 1,
        platforms: ["instagram"],
        staggerPlatforms: false,
        windowStart: WEEK_START,
        windowEnd: WEEK_END,
      };

      // Fill Monday with stories only — should still be treated as empty
      const existing = [
        { scheduledFor: makeDate(2026, 4, 13), platform: "instagram", placement: "story" },
        { scheduledFor: makeDate(2026, 4, 13), platform: "instagram", placement: "story" },
      ];

      const slots = buildSpreadEvenlySlots(config, existing);

      expect(slots).toHaveLength(1);
      // Monday should still be available (stories don't count)
      // The algorithm picks the first emptiest day, which is Monday
      expect(toLocalDateStr(slots[0]!.date)).toBe("2026-04-13");
    });
  });
});

describe("calendarDayDiff", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  it("returns 0 for same calendar day regardless of time gap", () => {
    expect(calendarDayDiff(at("2026-05-18T01:00"), at("2026-05-18T23:59"), TZ)).toBe(0);
  });

  it("returns 1 when dates are on adjacent calendar days", () => {
    expect(calendarDayDiff(at("2026-05-18T23:00"), at("2026-05-19T01:00"), TZ)).toBe(1);
  });

  it("returns 1 even with 46 elapsed hours on adjacent calendar days", () => {
    expect(calendarDayDiff(at("2026-05-18T01:00"), at("2026-05-19T23:00"), TZ)).toBe(1);
  });

  it("returns 2 for Monday noon to Wednesday evening", () => {
    expect(calendarDayDiff(at("2026-05-18T12:00"), at("2026-05-20T19:00"), TZ)).toBe(2);
  });

  it("returns 7 for exactly one week apart", () => {
    expect(calendarDayDiff(at("2026-05-18T12:00"), at("2026-05-25T12:00"), TZ)).toBe(7);
  });

  it("returns negative when earlier is after later", () => {
    expect(calendarDayDiff(at("2026-05-20T12:00"), at("2026-05-18T12:00"), TZ)).toBe(-2);
  });

  it("handles BST spring-forward (28 Mar -> 29 Mar 2026)", () => {
    expect(calendarDayDiff(at("2026-03-28T12:00"), at("2026-03-29T14:00"), TZ)).toBe(1);
  });

  it("handles BST autumn-fallback (25 Oct -> 26 Oct 2026)", () => {
    expect(calendarDayDiff(at("2026-10-25T12:00"), at("2026-10-26T12:00"), TZ)).toBe(1);
  });
});
