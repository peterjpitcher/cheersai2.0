import { describe, expect, it, vi, beforeEach } from "vitest";
import { DateTime } from "luxon";
import { deconflictCampaignPlans } from "@/lib/scheduling/deconflict";
import { toDayKey } from "@/lib/scheduling/spread";

const TZ = "Europe/London";

/** Helper: create a Date at a specific day and time in Europe/London. */
function londonDate(iso: string, hour = 12, minute = 0): Date {
  return DateTime.fromISO(iso, { zone: TZ })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toJSDate();
}

interface QueryBounds {
  from?: string;
  to?: string;
  toInclusive?: boolean;
}

/**
 * Minimal mock Supabase client over content_items. It applies the query's
 * scheduled_for bounds the way the database would (so a window that is too
 * narrow drops rows) and records them in `bounds`.
 */
function mockSupabase(
  existingItems: Array<{ scheduled_for: string }> = [],
  bounds: QueryBounds = {},
) {
  const run = () => {
    const from = Date.parse(bounds.from!);
    const to = Date.parse(bounds.to!);
    const data = existingItems.filter((item) => {
      const at = Date.parse(item.scheduled_for);
      return at >= from && (bounds.toInclusive ? at <= to : at < to);
    });
    return Promise.resolve({ data, error: null });
  };
  const upper = (toInclusive: boolean) => (_column: string, to: string) => {
    Object.assign(bounds, { to, toInclusive });
    return { not: run };
  };
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: (_column: string, from: string) => {
            bounds.from = from;
            return { lte: upper(true), lt: upper(false) };
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof deconflictCampaignPlans>[0];
}

function samePlans(count: number, scheduledFor: Date) {
  return Array.from({ length: count }, (_, i) => ({
    scheduledFor,
    platforms: ["instagram"],
    title: `Post ${i + 1}`,
  }));
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

describe("deconflictCampaignPlans occupancy window", () => {
  const busy = (...dates: Date[]) => dates.map((d) => ({ scheduled_for: d.toISOString() }));

  it("counts a post in the first half hour of 25 Oct 2026 for a plan at 27 Oct 23:30 GMT", async () => {
    // The second plan can move to 26, 28, 25 then 29 Oct. 26 and 28 are busy;
    // 25 Oct is busy only through a post at 00:15 BST, which a window of
    // 72 elapsed hours (starting 25 Oct 00:30 BST) missed.
    const bounds: QueryBounds = {};
    const existingItems = busy(
      londonDate("2026-10-26", 12, 0),
      londonDate("2026-10-28", 12, 0),
      londonDate("2026-10-25", 0, 15),
    );

    const result = await deconflictCampaignPlans(
      mockSupabase(existingItems, bounds),
      "account-1",
      samePlans(2, londonDate("2026-10-27", 23, 30)),
      TZ,
    );

    expect(result.map((p) => toDayKey(p.scheduledFor!, TZ))).toEqual(["2026-10-27", "2026-10-29"]);
    // 25 Oct 00:00 BST to 30 Oct 00:00 GMT, end exclusive.
    expect(bounds).toEqual({
      from: "2026-10-24T23:00:00.000Z",
      to: "2026-10-30T00:00:00.000Z",
      toInclusive: false,
    });
  });

  it("counts a post in the last half hour of 25 Oct 2026 for a plan at 23 Oct 00:30 BST", async () => {
    // The second plan can move to 22, 24, 21 then 25 Oct. The first three are
    // busy; 25 Oct is busy only through a post at 23:45 GMT, which a window of
    // 72 elapsed hours (ending 25 Oct 23:30 GMT) missed. No day is free, so
    // the plan stays.
    const existingItems = busy(
      londonDate("2026-10-22", 12, 0),
      londonDate("2026-10-24", 12, 0),
      londonDate("2026-10-21", 12, 0),
      londonDate("2026-10-25", 23, 45),
    );

    const result = await deconflictCampaignPlans(
      mockSupabase(existingItems),
      "account-1",
      samePlans(2, londonDate("2026-10-23", 0, 30)),
      TZ,
    );

    expect(result.map((p) => toDayKey(p.scheduledFor!, TZ))).toEqual(["2026-10-23", "2026-10-23"]);
  });

  it("runs from London midnight two days before the first plan to midnight three days after the last, across 28 Mar 2027", async () => {
    const bounds: QueryBounds = {};
    const plans = [
      { scheduledFor: londonDate("2027-03-30", 12, 0), platforms: ["instagram"], title: "Post A" },
      { scheduledFor: londonDate("2027-04-01", 12, 0), platforms: ["instagram"], title: "Post B" },
    ];

    await deconflictCampaignPlans(mockSupabase([], bounds), "account-1", plans, TZ);

    // 28 Mar 00:00 GMT to 4 Apr 00:00 BST.
    expect(bounds).toEqual({
      from: "2027-03-28T00:00:00.000Z",
      to: "2027-04-03T23:00:00.000Z",
      toInclusive: false,
    });
  });

  it("uses the same calendar-day window on a normal day", async () => {
    const bounds: QueryBounds = {};

    await deconflictCampaignPlans(
      mockSupabase([], bounds),
      "account-1",
      samePlans(2, londonDate("2026-04-15", 12, 0)),
      TZ,
    );

    // 13 Apr 00:00 BST to 18 Apr 00:00 BST.
    expect(bounds).toEqual({
      from: "2026-04-12T23:00:00.000Z",
      to: "2026-04-17T23:00:00.000Z",
      toInclusive: false,
    });
  });
});
