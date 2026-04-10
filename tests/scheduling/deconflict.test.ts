import { describe, expect, it, vi, beforeEach } from "vitest";
import { DateTime } from "luxon";
import { deconflictCampaignPlans } from "@/lib/scheduling/deconflict";
import { getEngagementOptimisedHour, toDayKey } from "@/lib/scheduling/spread";

const TZ = "Europe/London";

/** Helper: create a Date at a specific day and time in Europe/London. */
function londonDate(iso: string, hour = 12, minute = 0): Date {
  return DateTime.fromISO(iso, { zone: TZ })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toJSDate();
}

/** Minimal mock Supabase client that returns empty content_items. */
function mockSupabase(existingItems: Array<{ scheduled_for: string }> = []) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              not: () =>
                Promise.resolve({ data: existingItems, error: null }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof deconflictCampaignPlans>[0];
}

describe("deconflictCampaignPlans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shifts one of two plans on the same day to an adjacent day", async () => {
    // Two plans both on Wednesday 2026-04-15
    const plans = [
      {
        scheduledFor: londonDate("2026-04-15", 12, 0),
        platforms: ["instagram"],
        title: "1 week before",
      },
      {
        scheduledFor: londonDate("2026-04-15", 12, 0),
        platforms: ["instagram"],
        title: "2 weeks before",
      },
    ];

    const result = await deconflictCampaignPlans(
      mockSupabase(),
      "account-1",
      plans,
      TZ,
    );

    // One should stay on the 15th, the other should move
    const dayKeys = result.map((p) => toDayKey(p.scheduledFor!, TZ));
    expect(dayKeys[0]).not.toEqual(dayKeys[1]);

    // The shifted plan should be within ±2 days of the original
    const originalDt = DateTime.fromISO("2026-04-15", { zone: TZ });
    for (const plan of result) {
      const planDt = DateTime.fromJSDate(plan.scheduledFor!, { zone: TZ });
      const dayDiff = Math.abs(planDt.diff(originalDt, "days").days);
      expect(dayDiff).toBeLessThanOrEqual(2);
    }
  });

  it("does not shift pinned (same-day) plans", async () => {
    const eventDay = londonDate("2026-04-22", 17, 0);
    const plans = [
      {
        scheduledFor: eventDay,
        platforms: ["instagram"],
        title: "Day-of post",
        pinned: true,
      },
      {
        scheduledFor: londonDate("2026-04-22", 12, 0),
        platforms: ["instagram"],
        title: "Day-before post that accidentally lands same day",
      },
    ];

    const result = await deconflictCampaignPlans(
      mockSupabase(),
      "account-1",
      plans,
      TZ,
    );

    // Pinned plan stays on the 22nd
    expect(toDayKey(result[0]!.scheduledFor!, TZ)).toEqual("2026-04-22");
    // Unpinned plan shifts off
    expect(toDayKey(result[1]!.scheduledFor!, TZ)).not.toEqual("2026-04-22");
  });

  it("avoids existing busy days when shifting", async () => {
    // Plan on the 15th, but the 14th already has content
    const existingItems = [
      { scheduled_for: londonDate("2026-04-14", 10, 0).toISOString() },
    ];
    const plans = [
      {
        scheduledFor: londonDate("2026-04-15", 12, 0),
        platforms: ["instagram"],
        title: "Post A",
      },
      {
        scheduledFor: londonDate("2026-04-15", 12, 0),
        platforms: ["instagram"],
        title: "Post B",
      },
    ];

    const result = await deconflictCampaignPlans(
      mockSupabase(existingItems),
      "account-1",
      plans,
      TZ,
    );

    const dayKeys = result.map((p) => toDayKey(p.scheduledFor!, TZ));
    // The shifted plan should NOT go to the 14th (busy)
    const shifted = dayKeys.find((k) => k !== "2026-04-15");
    expect(shifted).toBeDefined();
    expect(shifted).not.toEqual("2026-04-14");
  });

  it("returns plans unchanged when only one plan exists", async () => {
    const plans = [
      {
        scheduledFor: londonDate("2026-04-15", 12, 0),
        platforms: ["instagram"],
        title: "Solo post",
      },
    ];

    const result = await deconflictCampaignPlans(
      mockSupabase(),
      "account-1",
      plans,
      TZ,
    );

    expect(result).toEqual(plans);
  });

  it("leaves plans on different days untouched", async () => {
    const plans = [
      {
        scheduledFor: londonDate("2026-04-13", 12, 0),
        platforms: ["instagram"],
        title: "Post A",
      },
      {
        scheduledFor: londonDate("2026-04-15", 12, 0),
        platforms: ["instagram"],
        title: "Post B",
      },
      {
        scheduledFor: londonDate("2026-04-22", 17, 0),
        platforms: ["instagram"],
        title: "Post C",
      },
    ];

    const result = await deconflictCampaignPlans(
      mockSupabase(),
      "account-1",
      plans,
      TZ,
    );

    // All should stay on their original days
    expect(toDayKey(result[0]!.scheduledFor!, TZ)).toEqual("2026-04-13");
    expect(toDayKey(result[1]!.scheduledFor!, TZ)).toEqual("2026-04-15");
    expect(toDayKey(result[2]!.scheduledFor!, TZ)).toEqual("2026-04-22");
  });

  it("preserves the time of day when shifting to an adjacent day", async () => {
    const plans = [
      {
        scheduledFor: londonDate("2026-04-15", 17, 0),
        platforms: ["instagram"],
        title: "Post A",
        pinned: true,
      },
      {
        scheduledFor: londonDate("2026-04-15", 12, 30),
        platforms: ["instagram"],
        title: "Post B",
      },
    ];

    const result = await deconflictCampaignPlans(
      mockSupabase(),
      "account-1",
      plans,
      TZ,
    );

    // The shifted plan should keep its 12:30 time
    const shiftedPlan = result.find(
      (p) => toDayKey(p.scheduledFor!, TZ) !== "2026-04-15",
    );
    expect(shiftedPlan).toBeDefined();
    const dt = DateTime.fromJSDate(shiftedPlan!.scheduledFor!, { zone: TZ });
    expect(dt.hour).toEqual(12);
    expect(dt.minute).toEqual(30);
  });
});

describe("getEngagementOptimisedHour", () => {
  it("returns 17:00 for same-day event posts (no user default)", () => {
    const eventDate = londonDate("2026-04-22", 19, 0);
    const scheduledDate = londonDate("2026-04-22", 7, 0);

    const result = getEngagementOptimisedHour(scheduledDate, eventDate, null, TZ);
    expect(result).toEqual({ hour: 17, minute: 0 });
  });

  it("returns 12:00 for advance event posts (no user default)", () => {
    const eventDate = londonDate("2026-04-22", 19, 0);
    const scheduledDate = londonDate("2026-04-15", 7, 0); // 1 week before

    const result = getEngagementOptimisedHour(scheduledDate, eventDate, null, TZ);
    expect(result).toEqual({ hour: 12, minute: 0 });
  });

  it("uses defaultPostingTime when set", () => {
    const eventDate = londonDate("2026-04-22", 19, 0);
    const scheduledDate = londonDate("2026-04-15", 7, 0);

    const result = getEngagementOptimisedHour(
      scheduledDate,
      eventDate,
      "14:30",
      TZ,
    );
    expect(result).toEqual({ hour: 14, minute: 30 });
  });

  it("falls back to 12:00 when no event date and no user default", () => {
    const scheduledDate = londonDate("2026-04-15", 7, 0);

    const result = getEngagementOptimisedHour(scheduledDate, null, null, TZ);
    expect(result).toEqual({ hour: 12, minute: 0 });
  });

  it("ignores malformed defaultPostingTime", () => {
    const scheduledDate = londonDate("2026-04-15", 7, 0);

    const result = getEngagementOptimisedHour(
      scheduledDate,
      null,
      "not-a-time",
      TZ,
    );
    expect(result).toEqual({ hour: 12, minute: 0 });
  });
});
