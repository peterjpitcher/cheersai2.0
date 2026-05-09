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
        dayOfWeek: 4, // Thursday — same value in JS and Luxon
        time: "19:30",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("weekly");
    expect(result.weeklyDayOfWeek).toBe(4);
    expect(result.startTime).toBe("19:30");
  });

  // F6: metadata.dayOfWeek is stored as JS getDay() (0=Sun..6=Sat). The
  // CampaignTiming.weeklyDayOfWeek field must be expressed as a Luxon
  // weekday (1=Mon..7=Sun) so getNextWeeklyOccurrence works correctly.
  // 0 (Sunday in JS) must convert to 7 (Sunday in Luxon).
  it("should translate Sunday (JS 0) to Luxon Sunday (7)", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: {
        dayOfWeek: 0, // Sunday in JS getDay
        time: "12:00",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.weeklyDayOfWeek).toBe(7);
  });

  it("should leave Monday (JS 1) as Luxon 1", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: { dayOfWeek: 1, time: "12:00" },
    };
    expect(extractCampaignTiming(campaign).weeklyDayOfWeek).toBe(1);
  });

  it("should leave Saturday (JS 6) as Luxon 6", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: { dayOfWeek: 6, time: "12:00" },
    };
    expect(extractCampaignTiming(campaign).weeklyDayOfWeek).toBe(6);
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

  it("should return today when startTime supplied and not yet reached", () => {
    // Thursday 08:00, event at 19:00 — still today's occurrence
    const ref = DateTime.fromISO("2026-05-07T08:00:00", { zone: TZ });
    const result = getNextWeeklyOccurrence(ref, 4, TZ, "19:00");
    expect(result.toISODate()).toBe("2026-05-07");
  });

  it("should roll to next week when startTime supplied and event time has passed", () => {
    // Thursday 20:00, event was at 19:00 — should advance to next Thursday
    const ref = DateTime.fromISO("2026-05-07T20:00:00", { zone: TZ });
    const result = getNextWeeklyOccurrence(ref, 4, TZ, "19:00");
    expect(result.toISODate()).toBe("2026-05-14"); // Thursday next week
  });
});
