// tests/lib/scheduling/campaign-timing.test.ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  extractCampaignTiming,
  getNextWeeklyOccurrence,
} from "@/lib/scheduling/campaign-timing";

const TZ = "Europe/London";

describe("extractCampaignTiming", () => {
  it("should extract event campaign timing", () => {
    const campaign = {
      campaign_type: "event",
      metadata: {
        startDate: "2026-05-06",
        startTime: "19:00",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("event");
    expect(result.startAt.toISODate()).toBe("2026-05-06");
    expect(result.startTime).toBe("19:00");
    expect(result.endAt).toBeUndefined();
    expect(result.timezone).toBe(TZ);
  });

  it("should extract promotion campaign timing with end date", () => {
    const campaign = {
      campaign_type: "promotion",
      metadata: {
        startDate: "2026-05-01",
        endDate: "2026-05-15",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("promotion");
    expect(result.startAt.toISODate()).toBe("2026-05-01");
    expect(result.endAt?.toISODate()).toBe("2026-05-15");
    expect(result.startTime).toBeUndefined();
  });

  it("should extract weekly campaign timing", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: {
        dayOfWeek: 4, // Thursday
        time: "19:30",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("weekly");
    expect(result.weeklyDayOfWeek).toBe(4);
    expect(result.startTime).toBe("19:30");
  });

  it("should handle event with eventStart ISO string (legacy metadata)", () => {
    const campaign = {
      campaign_type: "event",
      metadata: {
        eventStart: "2026-05-06T19:00:00.000Z",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("event");
    expect(result.startAt).toBeDefined();
  });
});

describe("getNextWeeklyOccurrence", () => {
  it("should return this week's day if before it", () => {
    // Monday referencing Thursday (dayOfWeek=4)
    const ref = DateTime.fromISO("2026-05-04T10:00:00", { zone: TZ }); // Monday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.weekday).toBe(4);
    expect(result.toISODate()).toBe("2026-05-07"); // Thursday same week
  });

  it("should return next week's day if after it", () => {
    // Friday referencing Thursday (dayOfWeek=4)
    const ref = DateTime.fromISO("2026-05-08T10:00:00", { zone: TZ }); // Friday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.weekday).toBe(4);
    expect(result.toISODate()).toBe("2026-05-14"); // Thursday next week
  });

  it("should return today if same day and time not yet passed", () => {
    // Thursday morning referencing Thursday
    const ref = DateTime.fromISO("2026-05-07T08:00:00", { zone: TZ }); // Thursday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.toISODate()).toBe("2026-05-07");
  });
});
