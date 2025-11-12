import { describe, expect, it } from "vitest";

import { buildEventCadenceSlots, buildEventScheduleOffsets } from "@/lib/create/event-cadence";

describe("buildEventCadenceSlots", () => {
  it("includes weekly hype beats plus countdown reminders", () => {
    const slots = buildEventCadenceSlots({
      startDate: "2024-12-01",
      startTime: "18:00",
      timezone: "Europe/London",
      now: new Date("2024-09-01T09:00:00Z"),
      maxWeekly: 6,
    });

    const labels = slots.map((slot) => slot.label);
    expect(labels).toContain("3 days to go");
    expect(labels).toContain("2 days to go");
    expect(labels).toContain("Event day");
    expect(labels.filter((label) => label.startsWith("Weekly hype")).length).toBeGreaterThan(0);
    expect(slots.length).toBeGreaterThan(0);
    const firstSlot = slots[0];
    const lastSlot = slots[slots.length - 1];
    expect(firstSlot.occurs.toMillis()).toBeLessThan(lastSlot.occurs.toMillis());
  });

  it("filters out past slots while keeping the day-of beat", () => {
    const slots = buildEventCadenceSlots({
      startDate: "2024-01-10",
      startTime: "18:00",
      timezone: "Europe/London",
      now: new Date("2024-01-08T09:00:00Z"),
    });

    expect(slots.some((slot) => slot.label === "Event day")).toBe(true);
    expect(slots.some((slot) => slot.label.startsWith("Weekly hype"))).toBe(false);
  });
});

describe("buildEventScheduleOffsets", () => {
  it("produces offsets relative to the event start time", () => {
    const offsets = buildEventScheduleOffsets({
      startDate: "2024-09-28",
      startTime: "18:00",
      timezone: "Europe/London",
      now: new Date("2024-08-01T09:00:00Z"),
    });

    const dayOf = offsets.find((entry) => entry.label === "Event day");
    const threeDays = offsets.find((entry) => entry.label === "3 days to go");
    const weekly = offsets.find((entry) => entry.label.startsWith("Weekly hype"));

    expect(dayOf?.offsetHours).toBe(0);
    expect(threeDays?.offsetHours).toBeCloseTo(-72, 5);
    expect(weekly && weekly.offsetHours).toBeLessThan(-24);
  });
});
