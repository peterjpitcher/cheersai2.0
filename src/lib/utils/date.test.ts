import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import { formatEventDateLong, ordinalSuffix } from "@/lib/utils/date";

describe("ordinalSuffix", () => {
  it("returns st/nd/rd/th for the units digit", () => {
    expect(ordinalSuffix(1)).toBe("st");
    expect(ordinalSuffix(2)).toBe("nd");
    expect(ordinalSuffix(3)).toBe("rd");
    expect(ordinalSuffix(4)).toBe("th");
    expect(ordinalSuffix(21)).toBe("st");
    expect(ordinalSuffix(22)).toBe("nd");
    expect(ordinalSuffix(23)).toBe("rd");
    expect(ordinalSuffix(31)).toBe("st");
  });

  it("returns th for the 11-13 exceptions", () => {
    expect(ordinalSuffix(11)).toBe("th");
    expect(ordinalSuffix(12)).toBe("th");
    expect(ordinalSuffix(13)).toBe("th");
  });
});

describe("formatEventDateLong", () => {
  it('formats an ISO date as "Weekday Nth Month" (no year)', () => {
    expect(formatEventDateLong("2026-07-17")).toBe("Friday 17th July");
    expect(formatEventDateLong("2026-07-01")).toBe("Wednesday 1st July");
    expect(formatEventDateLong("2026-06-02")).toBe("Tuesday 2nd June");
    expect(formatEventDateLong("2026-06-03")).toBe("Wednesday 3rd June");
    expect(formatEventDateLong("2026-07-11")).toBe("Saturday 11th July");
    expect(formatEventDateLong("2026-07-21")).toBe("Tuesday 21st July");
  });

  it("accepts a Luxon DateTime", () => {
    const dt = DateTime.fromISO("2026-07-17T20:00", { zone: "Europe/London" });
    expect(formatEventDateLong(dt)).toBe("Friday 17th July");
  });

  it("formats in Europe/London, not UTC (late-evening instant stays same day)", () => {
    // 2026-07-17T23:30+01:00 is still the 17th in London.
    const dt = DateTime.fromISO("2026-07-17T23:30", { zone: "Europe/London" });
    expect(formatEventDateLong(dt)).toBe("Friday 17th July");
  });
});
