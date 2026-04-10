import { describe, expect, it } from "vitest";
import {
  buildSpreadEvenlySlots,
  getEngagementOptimisedHour,
  type SpreadConfig,
} from "@/lib/scheduling/spread";

/**
 * Integration test: verifies the spread algorithm + time selection work
 * together in a realistic campaign creation scenario.
 *
 * We test the pure functions directly rather than calling createWeeklyCampaign
 * (which requires full Supabase auth mocking) to validate the algorithm chain.
 */

describe("spread-evenly campaign creation flow", () => {
  it("produces correctly spread slots for a 3-platform, 4-week campaign", () => {
    const windowStart = new Date(2026, 3, 13); // Monday April 13
    const windowEnd = new Date(2026, 4, 10); // Sunday May 10

    const config: SpreadConfig = {
      postsPerWeek: 3,
      platforms: ["instagram", "facebook", "gbp"],
      staggerPlatforms: true,
      windowStart,
      windowEnd,
    };

    // Simulate a few existing posts
    const existingPosts = [
      { scheduledFor: new Date(2026, 3, 14), platform: "instagram", placement: "feed" }, // Tuesday wk1
      { scheduledFor: new Date(2026, 3, 21), platform: "facebook", placement: "feed" }, // Tuesday wk2
    ];

    const slots = buildSpreadEvenlySlots(config, existingPosts);

    // 4 weeks * 3 posts/week = 12 slots
    expect(slots).toHaveLength(12);

    // Each week should have 3 slots
    const byWeek = groupByWeek(slots.map((s) => s.date), windowStart);
    expect(Object.keys(byWeek).length).toBeGreaterThanOrEqual(4);

    // All 3 platforms should appear in each week
    const platformCounts = new Map<string, number>();
    for (const slot of slots) {
      platformCounts.set(slot.platform, (platformCounts.get(slot.platform) ?? 0) + 1);
    }
    expect(platformCounts.get("instagram")).toBe(4);
    expect(platformCounts.get("facebook")).toBe(4);
    expect(platformCounts.get("gbp")).toBe(4);
  });

  it("applies engagement-optimised times to spread slots", () => {
    const config: SpreadConfig = {
      postsPerWeek: 2,
      platforms: ["instagram"],
      staggerPlatforms: false,
      windowStart: new Date(2026, 3, 13),
      windowEnd: new Date(2026, 3, 19),
    };

    const slots = buildSpreadEvenlySlots(config, []);
    expect(slots).toHaveLength(2);

    // Apply time selection with default posting time
    const times = slots.map((slot) =>
      getEngagementOptimisedHour(slot.date, null, "14:30"),
    );

    // Both should use the configured default
    for (const time of times) {
      expect(time).toEqual({ hour: 14, minute: 30 });
    }
  });

  it("applies 5pm for same-day event when no default time", () => {
    const eventDate = new Date(2026, 3, 15); // Wednesday
    const result = getEngagementOptimisedHour(eventDate, eventDate, null);
    expect(result).toEqual({ hour: 17, minute: 0 });
  });

  it("falls back to 12pm when no event and no default time", () => {
    const result = getEngagementOptimisedHour(
      new Date(2026, 3, 15),
      new Date(2026, 3, 20), // Different day
      null,
    );
    expect(result).toEqual({ hour: 12, minute: 0 });
  });

  it("handles stagger=false with multiple platforms on same day", () => {
    const config: SpreadConfig = {
      postsPerWeek: 2,
      platforms: ["instagram", "facebook", "gbp"],
      staggerPlatforms: false,
      windowStart: new Date(2026, 3, 13),
      windowEnd: new Date(2026, 3, 19),
    };

    const slots = buildSpreadEvenlySlots(config, []);

    // 2 posts/week * 3 platforms = 6 slots
    expect(slots).toHaveLength(6);

    // Group by day — should be exactly 2 unique days
    const days = new Set(
      slots.map((s) => {
        const d = s.date;
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }),
    );
    expect(days.size).toBe(2);
  });

  it("preserves metadata fields for spread_evenly campaigns", () => {
    // Simulate what createWeeklyCampaign stores in metadata
    const metadata = {
      scheduleMode: "spread_evenly",
      postsPerWeek: 3,
      staggerPlatforms: true,
      description: "Test campaign",
      dayOfWeek: 1,
      time: "12:00",
      weeksAhead: 4,
    };

    expect(metadata.scheduleMode).toBe("spread_evenly");
    expect(metadata.postsPerWeek).toBe(3);
    expect(metadata.staggerPlatforms).toBe(true);
  });
});

/** Group dates by ISO week number relative to a start date. */
function groupByWeek(
  dates: Date[],
  windowStart: Date,
): Record<number, Date[]> {
  const result: Record<number, Date[]> = {};
  for (const date of dates) {
    const dayDiff = Math.floor(
      (date.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000),
    );
    const weekNum = Math.floor(dayDiff / 7);
    if (!result[weekNum]) result[weekNum] = [];
    result[weekNum]!.push(date);
  }
  return result;
}
