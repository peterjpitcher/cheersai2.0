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
  it("should return null for 7+ days before event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"),
      campaignTiming: eventTiming("2026-05-08", "19:00"),
    });
    expect(result).toBeNull();
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

  it("should return null for Saturday→Saturday (7 days)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-02T10:00:00"), // Saturday
      campaignTiming: eventTiming("2026-05-09", "19:00"), // next Saturday
    });
    expect(result).toBeNull();
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

  it("should return ON NOW on start day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("ON NOW");
  });

  it("should return ON NOW during promotion, end 7+ days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("ON NOW");
  });

  it("should return ENDS {WEEKDAY} during, end 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-15T10:00:00"), // Friday
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"), // ends Wednesday
    });
    expect(result).toBe("ENDS WEDNESDAY");
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
