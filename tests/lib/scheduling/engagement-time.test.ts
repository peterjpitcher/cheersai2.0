import { describe, expect, it } from "vitest";
import { getEngagementOptimisedHour } from "@/lib/scheduling/spread";

describe("getEngagementOptimisedHour", () => {
  describe("with defaultPostingTime set", () => {
    it("parses and returns the default posting time", () => {
      const result = getEngagementOptimisedHour(
        new Date("2026-04-15T10:00:00Z"),
        new Date("2026-04-20T19:00:00Z"),
        "09:30",
      );
      expect(result).toEqual({ hour: 9, minute: 30 });
    });

    it("returns the default even when event is same day", () => {
      const sameDay = new Date("2026-04-15T10:00:00Z");
      const result = getEngagementOptimisedHour(sameDay, sameDay, "14:00");
      expect(result).toEqual({ hour: 14, minute: 0 });
    });

    it("handles midnight (00:00) as valid posting time", () => {
      const result = getEngagementOptimisedHour(
        new Date("2026-04-15T10:00:00Z"),
        null,
        "00:00",
      );
      expect(result).toEqual({ hour: 0, minute: 0 });
    });

    it("handles 23:59 as valid posting time", () => {
      const result = getEngagementOptimisedHour(
        new Date("2026-04-15T10:00:00Z"),
        null,
        "23:59",
      );
      expect(result).toEqual({ hour: 23, minute: 59 });
    });
  });

  describe("with invalid or null defaultPostingTime", () => {
    it("returns 17:00 when event is same day", () => {
      const day = new Date(2026, 3, 15); // April 15
      const eventDate = new Date(2026, 3, 15); // Same day
      const result = getEngagementOptimisedHour(day, eventDate, null);
      expect(result).toEqual({ hour: 17, minute: 0 });
    });

    it("returns 12:00 when event is on a different day", () => {
      const day = new Date(2026, 3, 13); // April 13
      const eventDate = new Date(2026, 3, 20); // April 20
      const result = getEngagementOptimisedHour(day, eventDate, null);
      expect(result).toEqual({ hour: 12, minute: 0 });
    });

    it("returns 12:00 when eventDate is null", () => {
      const day = new Date(2026, 3, 15);
      const result = getEngagementOptimisedHour(day, null, null);
      expect(result).toEqual({ hour: 12, minute: 0 });
    });

    it("falls through to 12:00 for empty string defaultPostingTime", () => {
      const day = new Date(2026, 3, 15);
      const result = getEngagementOptimisedHour(day, null, "");
      expect(result).toEqual({ hour: 12, minute: 0 });
    });

    it("falls through to default for invalid format", () => {
      const day = new Date(2026, 3, 15);
      const result = getEngagementOptimisedHour(day, null, "invalid");
      expect(result).toEqual({ hour: 12, minute: 0 });
    });
  });

  describe("same-day detection", () => {
    it("considers dates with different times on same calendar day as same-day", () => {
      const scheduled = new Date(2026, 3, 15, 9, 0); // 9am
      const event = new Date(2026, 3, 15, 19, 0); // 7pm
      const result = getEngagementOptimisedHour(scheduled, event, null);
      expect(result).toEqual({ hour: 17, minute: 0 });
    });
  });
});
