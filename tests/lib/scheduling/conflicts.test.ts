import { describe, expect, it } from "vitest";
import { resolveConflicts } from "@/lib/scheduling/conflicts";

describe("resolveConflicts", () => {
  it("resolves a third slot past all occupied slots on the same platform", () => {
    // Two existing slots at 12:00 and 12:30 on facebook.
    // A third slot at 12:00 should NOT resolve to 12:15 — it must skip
    // past 12:30 as well, landing on 13:00.
    //
    // After sorting by time the order is: a(12:00), c(12:00), b(12:30).
    const slots = [
      { id: "a", platform: "facebook" as const, scheduledFor: new Date("2026-01-05T12:00:00Z") },
      { id: "b", platform: "facebook" as const, scheduledFor: new Date("2026-01-05T12:30:00Z") },
      { id: "c", platform: "facebook" as const, scheduledFor: new Date("2026-01-05T12:00:00Z") },
    ];

    const results = resolveConflicts(slots);

    // First result: slot "a" at 12:00 — no conflict
    expect(results[0].slot.id).toBe("a");
    expect(results[0].slot.scheduledFor).toEqual(new Date("2026-01-05T12:00:00Z"));
    expect(results[0].conflictWith).toBeUndefined();

    // Second result: slot "c" at 12:00 conflicts with "a" — must resolve to 12:45 or later,
    // not 12:15, because 12:15 is within 30 min of "a" at 12:00 and needs to also
    // avoid "b" (which comes later but isn't in occupied yet). Actually, after sorting
    // c comes before b. So at the time c is processed, only a(12:00) is occupied.
    // The candidate offsets are +15, +30, +45...
    // +15 → 12:15 — within 30 min of a(12:00)? |12:15-12:00| = 15min < 30min → conflicts
    // +30 → 12:30 — |12:30-12:00| = 30min, NOT < 30min → no conflict → resolves to 12:30
    // Then b(12:30) is processed, occupied = [a@12:00, c@12:30].
    // b conflicts with c@12:30 (|12:30-12:30|=0 < 30min).
    // Resolution for b: offsets from c@12:30:
    // +15 → 12:45 — |12:45-12:00|=45min >=30, |12:45-12:30|=15min < 30 → conflicts with c
    // +30 → 13:00 — |13:00-12:00|=60min >=30, |13:00-12:30|=30min NOT<30 → OK → 13:00

    expect(results[1].slot.id).toBe("c");
    expect(results[1].resolution).toEqual(new Date("2026-01-05T12:30:00Z"));

    expect(results[2].slot.id).toBe("b");
    expect(results[2].resolution).toEqual(new Date("2026-01-05T13:00:00Z"));
  });

  it("resolves 3 slots all at 12:00 to 12:00, 12:30, and 13:00", () => {
    // All 3 new slots at exactly 12:00 on the same platform.
    // After resolution: first stays at 12:00, second resolves to 12:30,
    // third must resolve to 13:00 (not 12:15 or 12:30, which are too close).
    const slots = [
      { id: "x", platform: "facebook" as const, scheduledFor: new Date("2026-01-05T12:00:00Z") },
      { id: "y", platform: "facebook" as const, scheduledFor: new Date("2026-01-05T12:00:00Z") },
      { id: "z", platform: "facebook" as const, scheduledFor: new Date("2026-01-05T12:00:00Z") },
    ];

    const results = resolveConflicts(slots);

    // First slot: no conflict, stays at 12:00
    const first = results.find((r) => !r.conflictWith);
    expect(first).toBeDefined();
    expect(first!.slot.scheduledFor).toEqual(new Date("2026-01-05T12:00:00Z"));

    // Collect all resolved times
    const resolvedTimes = results.map((r) =>
      r.resolution ? r.resolution.getTime() : r.slot.scheduledFor.getTime(),
    );
    const uniqueTimes = new Set(resolvedTimes);

    // All 3 must have different times
    expect(uniqueTimes.size).toBe(3);

    // The times should be 12:00, 12:30, 13:00
    const expectedTimes = [
      new Date("2026-01-05T12:00:00Z").getTime(),
      new Date("2026-01-05T12:30:00Z").getTime(),
      new Date("2026-01-05T13:00:00Z").getTime(),
    ];
    for (const expected of expectedTimes) {
      expect(uniqueTimes.has(expected)).toBe(true);
    }
  });

  it("does not resolve across different platforms", () => {
    const slots = [
      { id: "a", platform: "facebook" as const, scheduledFor: new Date("2026-01-05T12:00:00Z") },
      { id: "b", platform: "instagram" as const, scheduledFor: new Date("2026-01-05T12:00:00Z") },
    ];

    const results = resolveConflicts(slots);

    expect(results[0].conflictWith).toBeUndefined();
    expect(results[1].conflictWith).toBeUndefined();
  });
});
