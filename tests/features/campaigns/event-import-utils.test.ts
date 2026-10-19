import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

import {
  buildBriefFromEvent,
  deriveStartDate,
} from "@/features/campaigns/event-import-utils";

describe("buildBriefFromEvent", () => {
  it("should include name, date, and description", () => {
    const result = buildBriefFromEvent(
      "Acoustic Fridays",
      "2026-03-20",
      "A great live music evening.",
    );
    expect(result).toBe(
      "Acoustic Fridays on 2026-03-20. A great live music evening.",
    );
  });

  it("should handle missing date", () => {
    const result = buildBriefFromEvent(
      "Acoustic Fridays",
      undefined,
      "A great live music evening.",
    );
    expect(result).toBe("Acoustic Fridays. A great live music evening.");
  });

  it("should handle missing description", () => {
    const result = buildBriefFromEvent("Acoustic Fridays", "2026-03-20", undefined);
    expect(result).toBe("Acoustic Fridays on 2026-03-20.");
  });

  it("should handle missing date and description", () => {
    const result = buildBriefFromEvent("Acoustic Fridays", undefined, undefined);
    expect(result).toBe("Acoustic Fridays.");
  });

  it("should trim whitespace from description", () => {
    const result = buildBriefFromEvent("Quiz Night", "2026-04-01", "  Great fun.  ");
    expect(result).toBe("Quiz Night on 2026-04-01. Great fun.");
  });
});

// deriveStartDate works in London dates, so "today" here must be London's too:
// between 00:00 and 01:00 BST the runner's UTC date is still yesterday.
const londonNow = (): DateTime => DateTime.now().setZone("Europe/London");

describe("deriveStartDate", () => {
  it("should return 7 days before a far-future event date", () => {
    const result = deriveStartDate("2026-12-25");
    expect(result).toBe("2026-12-18");
  });

  it("should return today when the event is less than 7 days away", () => {
    const tomorrow = londonNow().plus({ days: 1 }).toISODate()!;
    const today = londonNow().toISODate()!;
    const result = deriveStartDate(tomorrow);
    expect(result).toBe(today);
  });

  it("should return today when the event is exactly today", () => {
    const today = londonNow().toISODate()!;
    const result = deriveStartDate(today);
    expect(result).toBe(today);
  });

  it("should return today for a past event date", () => {
    const today = londonNow().toISODate()!;
    const result = deriveStartDate("2020-01-01");
    expect(result).toBe(today);
  });

  it("should return exactly 7 days before when the event is exactly 7 days away", () => {
    const sevenDaysFromNow = londonNow().plus({ days: 7 }).toISODate()!;
    const expectedStart = londonNow().toISODate()!;
    const result = deriveStartDate(sevenDaysFromNow);
    expect(result).toBe(expectedStart);
  });
});
