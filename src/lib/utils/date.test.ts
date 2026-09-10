import { afterEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import { formatEventDateLong, formatUkDate, formatUkDateTime, ordinalSuffix } from "@/lib/utils/date";

describe("formatUkDate and formatUkDateTime", () => {
  const originalTimeZone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTimeZone;
  });

  function inZone<T>(timeZone: string, run: () => T): T {
    process.env.TZ = timeZone;
    return run();
  }

  it("uses the London calendar day for a late-evening UTC instant in summer time", () => {
    // 23:30 UTC on 5 September 2026 is 00:30 on 6 September in London (BST).
    expect(formatUkDate("2026-09-05T23:30:00.000Z")).toBe("06/09/2026");
    expect(formatUkDateTime("2026-09-05T23:30:00.000Z")).toBe("06/09/2026, 00:30:00");
  });

  it("uses GMT in winter", () => {
    expect(formatUkDateTime("2026-12-01T23:30:00.000Z")).toBe("01/12/2026, 23:30:00");
  });

  it("gives the same string whatever the runtime time zone", () => {
    const iso = "2026-09-10T11:36:46.763981+00:00"; // Postgres timestamptz with microseconds
    const utc = inZone("UTC", () => [formatUkDate(iso), formatUkDateTime(iso), formatUkDate(new Date(iso))]);
    const london = inZone("Europe/London", () => [formatUkDate(iso), formatUkDateTime(iso), formatUkDate(new Date(iso))]);
    const newYork = inZone("America/New_York", () => [formatUkDate(iso), formatUkDateTime(iso), formatUkDate(new Date(iso))]);

    expect(utc).toEqual(["10/09/2026", "10/09/2026, 12:36:46", "10/09/2026"]);
    expect(london).toEqual(utc);
    expect(newYork).toEqual(utc);
  });

  it("returns an empty string for input that is not a date", () => {
    expect(formatUkDate("not a date")).toBe("");
    expect(formatUkDateTime(new Date(Number.NaN))).toBe("");
  });
});

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
