import { describe, expect, it } from "vitest";

import { buildEventCadenceSlots, buildEventScheduleOffsets } from "@/lib/create/event-cadence";

const TZ = "Europe/London";

/** Each slot as "<label> <ISO with London offset>", in cadence order. */
function describeSlots(slots: ReturnType<typeof buildEventCadenceSlots>): string[] {
  return slots.map((slot) => `${slot.label} ${slot.occurs.toISO()}`);
}

describe("buildEventCadenceSlots", () => {
  it("includes weekly hype beats plus countdown reminders", () => {
    const slots = buildEventCadenceSlots({
      startDate: "2024-12-01",
      startTime: "18:00",
      timezone: TZ,
      now: new Date("2024-09-01T09:00:00Z"),
      maxWeekly: 6,
    });

    const labels = slots.map((slot) => slot.label);
    expect(labels).toContain("2 days to go");
    expect(labels).toContain("1 day to go");
    expect(labels).toContain("Event day");
    expect(labels.filter((label) => label.startsWith("Weekly hype")).length).toBeGreaterThan(0);
    expect(slots.length).toBeGreaterThan(0);
    const firstSlot = slots[0];
    const lastSlot = slots[slots.length - 1];
    expect(firstSlot.occurs.toMillis()).toBeLessThan(lastSlot.occurs.toMillis());
  });

  it("puts the event-day slot at 07:00 and every earlier slot at midday", () => {
    // The rule shipped in PR #31: the event-day post goes out first thing so
    // people still have time to see it and book; the run-up stays at midday.
    const slots = buildEventCadenceSlots({
      startDate: "2024-12-01",
      startTime: "18:00",
      timezone: TZ,
      now: new Date("2024-09-01T09:00:00Z"),
      maxWeekly: 6,
    });

    const eventDay = slots.filter((slot) => slot.label === "Event day");
    expect(eventDay.map((slot) => slot.occurs.toFormat("yyyy-MM-dd HH:mm"))).toEqual(["2024-12-01 07:00"]);
    const runUp = slots.filter((slot) => slot.label !== "Event day");
    expect(runUp.length).toBeGreaterThan(0);
    expect(runUp.every((slot) => slot.occurs.toFormat("HH:mm") === "12:00")).toBe(true);
  });

  it("keeps London clock times on the day the clocks go back (Sunday 25 October 2026)", () => {
    // BST ends at 02:00 on the event day, so the event-day post is at 07:00 GMT
    // (07:00 UTC) while the run-up days are still in BST (12:00 BST = 11:00 UTC).
    // 07:00 happens exactly once that day, so there is no ambiguous hour.
    const slots = buildEventCadenceSlots({
      startDate: "2026-10-25",
      startTime: "20:00",
      timezone: TZ,
      now: new Date("2026-10-12T08:00:00Z"),
    });

    expect(describeSlots(slots)).toEqual([
      "Weekly hype · 1 week out 2026-10-18T12:00:00.000+01:00",
      "2 days to go 2026-10-23T12:00:00.000+01:00",
      "1 day to go 2026-10-24T12:00:00.000+01:00",
      "Event day 2026-10-25T07:00:00.000+00:00",
    ]);
    expect(slots.at(-1)?.occurs.toUTC().toISO()).toBe("2026-10-25T07:00:00.000Z");
  });

  it("puts the event-day slot at 07:00 GMT for an event in winter", () => {
    const slots = buildEventCadenceSlots({
      startDate: "2026-11-14",
      startTime: "19:00",
      timezone: TZ,
      now: new Date("2026-11-02T09:00:00Z"),
    });

    expect(describeSlots(slots)).toEqual([
      "Weekly hype · 1 week out 2026-11-07T12:00:00.000+00:00",
      "2 days to go 2026-11-12T12:00:00.000+00:00",
      "1 day to go 2026-11-13T12:00:00.000+00:00",
      "Event day 2026-11-14T07:00:00.000+00:00",
    ]);
  });

  it("puts the event-day slot at 07:00 BST (06:00 UTC) for an event in summer", () => {
    const slots = buildEventCadenceSlots({
      startDate: "2026-06-20",
      startTime: "19:00",
      timezone: TZ,
      now: new Date("2026-06-10T08:00:00Z"),
    });

    expect(describeSlots(slots)).toEqual([
      "Weekly hype · 1 week out 2026-06-13T12:00:00.000+01:00",
      "2 days to go 2026-06-18T12:00:00.000+01:00",
      "1 day to go 2026-06-19T12:00:00.000+01:00",
      "Event day 2026-06-20T07:00:00.000+01:00",
    ]);
    expect(slots.at(-1)?.occurs.toUTC().toISO()).toBe("2026-06-20T06:00:00.000Z");
  });

  it("offers the event-day slot on the day itself only until 07:00 is less than 15 minutes away", () => {
    // Every cadence slot must be at least 15 minutes ahead, the event-day one
    // included. Once 07:00 has gone the owner picks their own time instead.
    const at = (now: string) =>
      buildEventCadenceSlots({ startDate: "2026-11-14", startTime: "19:00", timezone: TZ, now: new Date(now) }).map(
        (slot) => slot.label,
      );

    expect(at("2026-11-14T06:45:00Z")).toEqual(["Event day"]);
    expect(at("2026-11-14T06:46:00Z")).toEqual([]);
  });

  it("filters out past slots while keeping the final pre-event beat", () => {
    const slots = buildEventCadenceSlots({
      startDate: "2024-01-10",
      startTime: "18:00",
      timezone: TZ,
      now: new Date("2024-01-08T09:00:00Z"),
    });

    expect(slots.some((slot) => slot.label === "1 day to go")).toBe(true);
    expect(slots.some((slot) => slot.label === "Event day")).toBe(true);
    expect(slots.some((slot) => slot.label.startsWith("Weekly hype"))).toBe(false);
  });
});

describe("buildEventScheduleOffsets", () => {
  it("produces offsets relative to the event start time", () => {
    const offsets = buildEventScheduleOffsets({
      startDate: "2024-09-28",
      startTime: "18:00",
      timezone: TZ,
      now: new Date("2024-08-01T09:00:00Z"),
    });

    const oneDay = offsets.find((entry) => entry.label === "1 day to go");
    const twoDays = offsets.find((entry) => entry.label === "2 days to go");
    const eventDay = offsets.find((entry) => entry.label === "Event day");
    const weekly = offsets.find((entry) => entry.label.startsWith("Weekly hype"));

    // Event day at 07:00 for an 18:00 start; the days before at midday.
    expect(eventDay?.offsetHours).toBeCloseTo(-11, 5);
    expect(oneDay?.offsetHours).toBeCloseTo(-30, 5);
    expect(twoDays?.offsetHours).toBeCloseTo(-54, 5);
    expect(weekly && weekly.offsetHours).toBeLessThan(-24);
  });

  it("falls back to an event-day beat when all default slots are in the past", () => {
    const offsets = buildEventScheduleOffsets({
      startDate: "2024-01-10",
      startTime: "18:00",
      timezone: TZ,
      now: new Date("2024-01-10T16:00:00Z"),
    });

    expect(offsets).toHaveLength(1);
    expect(offsets[0]?.label).toBe("Event day");
    expect(offsets[0]?.offsetHours).toBeCloseTo(-11, 5);
  });
});
