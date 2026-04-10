import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { formatFriendlyTime, formatFriendlyTimeFromZoned } from "@/lib/utils/date";

describe("formatFriendlyTimeFromZoned", () => {
  it.each([
    [12, 0, "12pm"],
    [13, 30, "1:30pm"],
    [0, 0, "12am"],
    [6, 0, "6am"],
    [18, 45, "6:45pm"],
  ])("formats %i:%i as %s", (hour, minute, expected) => {
    const dt = DateTime.fromObject({ hour, minute }, { zone: "Europe/London" });
    expect(formatFriendlyTimeFromZoned(dt)).toBe(expected);
  });
});

describe("formatFriendlyTime", () => {
  it("converts a Date to friendly time via the default timezone", () => {
    // 2026-01-15 at noon UTC — Europe/London is UTC+0 in January
    const date = new Date("2026-01-15T12:00:00Z");
    expect(formatFriendlyTime(date)).toBe("12pm");
  });

  it("handles minutes correctly", () => {
    const date = new Date("2026-01-15T13:30:00Z");
    expect(formatFriendlyTime(date)).toBe("1:30pm");
  });
});
