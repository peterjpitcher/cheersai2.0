// tests/lib/scheduling/proximity-label.test.ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import type { CampaignTiming } from "@/lib/scheduling/campaign-timing";

const TZ = "Europe/London";

function eventTiming(date: string, time?: string): CampaignTiming {
  return {
    campaignType: "event",
    startAt: DateTime.fromISO(date, { zone: TZ }),
    startTime: time,
    timezone: TZ,
  };
}

function ref(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TZ });
}

describe("getProximityLabel — event campaigns", () => {
  it("should return NEXT {WEEKDAY} for 7 days before event", () => {
    // Extended in Wave 1: 7–13 days now produces NEXT [WEEKDAY] instead of null.
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-08", "19:00"), // Friday +7
    });
    expect(result).toBe("NEXT FRIDAY");
  });

  it("should return THIS {WEEKDAY} for 6 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS {WEEKDAY} for 2 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS MONDAY for Friday→Monday (3 days, cross-week)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-11", "19:00"), // Monday
    });
    expect(result).toBe("THIS MONDAY");
  });

  it("should return NEXT SATURDAY for Saturday→Saturday (7 days)", () => {
    // Extended in Wave 1: same-weekday-7-days resolves to NEXT [WEEKDAY], not null.
    const result = getProximityLabel({
      referenceAt: ref("2026-05-02T10:00:00"), // Saturday
      campaignTiming: eventTiming("2026-05-09", "19:00"), // next Saturday
    });
    expect(result).toBe("NEXT SATURDAY");
  });

  it("should return TOMORROW for 1 day before, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return TOMORROW NIGHT for 1 day before, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TOMORROW NIGHT");
  });

  it("should return TODAY for same day, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TONIGHT for same day, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TONIGHT");
  });

  it("should return TODAY when no start time specified", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TOMORROW when no start time, 1 day before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return null for post after event start timestamp", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T20:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });

  it("should return null for post day after event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });
});

function promoTiming(start: string, end: string): CampaignTiming {
  return {
    campaignType: "promotion",
    startAt: DateTime.fromISO(start, { zone: TZ }),
    endAt: DateTime.fromISO(end, { zone: TZ }),
    timezone: TZ,
  };
}

function weeklyTiming(dayOfWeek: number, time?: string): CampaignTiming {
  return {
    campaignType: "weekly",
    startAt: DateTime.now().setZone(TZ),
    weeklyDayOfWeek: dayOfWeek,
    startTime: time,
    timezone: TZ,
  };
}

describe("getProximityLabel — promotion campaigns", () => {
  it("should return null before start, 7+ days out", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"),
      campaignTiming: promoTiming("2026-05-09", "2026-05-20"),
    });
    expect(result).toBeNull();
  });

  it("should return THIS {WEEKDAY} before start, 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"), // starts Friday
    });
    expect(result).toBe("THIS FRIDAY");
  });

  it("should return TOMORROW before start, 1 day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return WEEKS LEFT on start day when end is 7+ days away", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-06-10"),
    });
    expect(result).toBe("4 WEEKS LEFT");
  });

  it("should return WEEKS LEFT during promotion when end is 7+ days away", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("1 WEEK LEFT");
  });

  it("should floor partial weeks for manager special countdowns", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-09T10:00:00"),
      campaignTiming: promoTiming("2026-05-01", "2026-05-31"),
    });
    expect(result).toBe("3 WEEKS LEFT");
  });

  it("should return DAYS LEFT during, end 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-18T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("2 DAYS LEFT");
  });

  it("should return ENDS TOMORROW during, end 1 day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-19T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("ENDS TOMORROW");
  });

  it("should return LAST DAY on end day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-20T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("LAST DAY");
  });

  it("should return null after end date EOD", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-21T00:00:01"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBeNull();
  });

  it("should keep ON NOW fallback for legacy promotions without an end date", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: {
        campaignType: "promotion",
        startAt: DateTime.fromISO("2026-05-08", { zone: TZ }),
        timezone: TZ,
      },
    });
    expect(result).toBe("ON NOW");
  });
});

describe("getProximityLabel — extended bands", () => {
  it("returns NEXT [WEEKDAY] for a target 7 days out (same weekday)", () => {
    // 2026-06-03 is Wednesday; +7 days is Wednesday 2026-06-10
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-10", "19:00"),
    });
    expect(result).toBe("NEXT WEDNESDAY");
  });

  it("returns NEXT [WEEKDAY] for a target 10 days out", () => {
    // 2026-06-03 is Wednesday; +10 days is Saturday 2026-06-13
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-13", "18:00"),
    });
    expect(result).toBe("NEXT SATURDAY");
  });

  it("returns date format for target 14+ days out", () => {
    // 2026-06-03 is Wednesday; +16 days is Friday 2026-06-19
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-19", "19:00"),
    });
    expect(result).toBe("FRI 19 JUN");
  });

  it("uses NEXT [WEEKDAY] for same-weekday-7-days, not THIS [WEEKDAY]", () => {
    // Wed → next Wed should be NEXT WEDNESDAY, not THIS WEDNESDAY
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-10", "10:00"),
    });
    expect(result).toBe("NEXT WEDNESDAY");
  });

  it("returns date format for next year", () => {
    // 2026-12-20 → 2027-01-05 is 16 days; 2027-01-05 is Tuesday
    const result = getProximityLabel({
      referenceAt: ref("2026-12-20T10:00:00"),
      campaignTiming: eventTiming("2027-01-05", "19:00"),
    });
    expect(result).toBe("TUE 5 JAN");
  });

  it("still returns null for a target in the past", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-06-10T10:00:00"),
      campaignTiming: eventTiming("2026-06-09", "19:00"),
    });
    expect(result).toBeNull();
  });

  // Wave 1: week-aware proximity-label fix — see PLAN.md Phase 1.
  // Each of the cases below is RED until the implementation is corrected
  // in Wave 2 to use Luxon `startOf("week")` calendar-week bucketing.

  it("bug regression: Sun → Sat 13 days returns date format (was NEXT SATURDAY)", () => {
    // THE BUG. Sun 10 May → Sat 23 May = 13 days, weekDiff = 2 → SAT 23 MAY.
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T06:00:00"),
      campaignTiming: eventTiming("2026-05-23", "19:00"),
    });
    expect(result).toBe("SAT 23 MAY");
  });

  it("Sat → Sat 14 days exact returns date format (sanity, unchanged)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-09T10:00:00"),
      campaignTiming: eventTiming("2026-05-23", "19:00"),
    });
    expect(result).toBe("SAT 23 MAY");
  });

  it("Sun → Mon 8 days returns date format (currently NEXT MONDAY — must change)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: eventTiming("2026-05-18", "19:00"),
    });
    expect(result).toBe("MON 18 MAY");
  });

  it("Sun → Sat 6 days returns THIS SATURDAY (proximity wins, unchanged)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: eventTiming("2026-05-16", "19:00"),
    });
    expect(result).toBe("THIS SATURDAY");
  });

  it("year boundary 7d: Tue 22 Dec → Tue 29 Dec returns NEXT TUESDAY", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-12-22T10:00:00"),
      campaignTiming: eventTiming("2026-12-29", "19:00"),
    });
    expect(result).toBe("NEXT TUESDAY");
  });

  it("year boundary 13d: Tue 22 Dec → Mon 4 Jan returns date format across year-end", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-12-22T10:00:00"),
      campaignTiming: eventTiming("2027-01-04", "19:00"),
    });
    expect(result).toBe("MON 4 JAN");
  });

  it("DST spring-forward 7d: Sun 22 Mar → Sun 29 Mar returns NEXT SUNDAY (23h week)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-03-22T10:00:00"),
      campaignTiming: eventTiming("2026-03-29", "19:00"),
    });
    expect(result).toBe("NEXT SUNDAY");
  });

  it("DST spring-forward 13d: Sun 22 Mar → Sat 4 Apr returns date format (spans BST start)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-03-22T10:00:00"),
      campaignTiming: eventTiming("2026-04-04", "19:00"),
    });
    expect(result).toBe("SAT 4 APR");
  });

  it("DST fall-back 7d: Sun 18 Oct → Sun 25 Oct returns NEXT SUNDAY (25h week)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-10-18T10:00:00"),
      campaignTiming: eventTiming("2026-10-25", "19:00"),
    });
    expect(result).toBe("NEXT SUNDAY");
  });

  it("DST fall-back 13d: Sun 18 Oct → Sat 31 Oct returns date format (spans GMT start)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-10-18T10:00:00"),
      campaignTiming: eventTiming("2026-10-31", "19:00"),
    });
    expect(result).toBe("SAT 31 OCT");
  });
});

describe("getProximityLabel — weekly campaigns", () => {
  it("should return THIS {WEEKDAY} for same week occurrence", () => {
    // Monday → Thursday event (dayOfWeek=4)
    const result = getProximityLabel({
      referenceAt: ref("2026-05-04T10:00:00"), // Monday
      campaignTiming: weeklyTiming(4, "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return TOMORROW for day before weekly occurrence", () => {
    // Wednesday → Thursday event
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"), // Wednesday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("TOMORROW NIGHT");
  });

  it("should return TONIGHT on the event day (evening)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T10:00:00"), // Thursday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("TONIGHT");
  });

  it("should look at next week after this week's occurrence", () => {
    // Friday after Thursday event → next Thursday is 6 days away
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"), // Friday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("THIS THURSDAY");
  });
});
