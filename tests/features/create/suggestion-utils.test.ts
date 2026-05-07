import { describe, expect, it } from "vitest";

import { deconflictSuggestions } from "@/features/create/schedule/suggestion-utils";
import type { SuggestedSlotDisplay } from "@/features/create/schedule/schedule-calendar";

const TZ = "Europe/London";

function suggestion(
  overrides: Partial<SuggestedSlotDisplay> = {},
): SuggestedSlotDisplay {
  return {
    id: overrides.id ?? "id",
    date: overrides.date ?? "2026-05-23",
    time: overrides.time ?? "12:00",
    label: overrides.label ?? "Suggestion",
  };
}

describe("deconflictSuggestions (Issue 2 regression)", () => {
  it("drops a countdown-labelled suggestion whose date is already occupied", () => {
    // Event on Saturday 2026-05-23. Cadence builds:
    //   2026-05-22 "1 day to go"  (occupied by an existing planner item)
    //   2026-05-23 "Event day"
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "minus-1d", date: "2026-05-22", label: "1 day to go" }),
      suggestion({ id: "event-day", date: "2026-05-23", label: "Event day" }),
    ];

    const existingItems = [{ date: "2026-05-22" }];

    const result = deconflictSuggestions(suggestions, existingItems, TZ);

    // Event day stays; the misaligned countdown is dropped (NOT relabelled or kept on a wrong day).
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("Event day");
    expect(result[0]?.date).toBe("2026-05-23");
  });

  it("drops weekly-hype suggestions when their slot is occupied", () => {
    // Two weekly cadence suggestions: 1 week out (occupied) and 2 weeks out (free).
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "weekly-2", date: "2026-05-09", label: "Weekly hype · 2 weeks out" }),
      suggestion({ id: "weekly-1", date: "2026-05-16", label: "Weekly hype · 1 week out" }),
    ];

    const existingItems = [{ date: "2026-05-16" }];

    const result = deconflictSuggestions(suggestions, existingItems, TZ);

    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("Weekly hype · 2 weeks out");
    expect(result[0]?.date).toBe("2026-05-09");
  });

  it("does not relabel or shift suggestions to a date that contradicts the label", () => {
    // Cadence labels carry meaning. If a suggestion at "1 day to go" can't keep its
    // date, it must be dropped — not shifted to the prior day where the label would lie.
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "minus-1d", date: "2026-05-22", label: "1 day to go" }),
    ];

    const existingItems = [{ date: "2026-05-22" }];

    const result = deconflictSuggestions(suggestions, existingItems, TZ);

    // The suggestion is dropped entirely; nothing relabelled, no shifted entries.
    expect(result).toHaveLength(0);
  });

  it("drops only the conflicting suggestion of two siblings on the same day", () => {
    // Two cadence suggestions accidentally land on the same day. The first claims it,
    // the second is dropped.
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "weekly-2", date: "2026-05-15", label: "Weekly hype · 2 weeks out" }),
      suggestion({ id: "minus-2d", date: "2026-05-15", label: "2 days to go" }),
    ];

    const result = deconflictSuggestions(suggestions, [], TZ);

    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("Weekly hype · 2 weeks out");
  });

  it("keeps Event day pinned and forces its time to 17:00", () => {
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "event-day", date: "2026-05-23", time: "12:00", label: "Event day" }),
    ];

    const result = deconflictSuggestions(suggestions, [{ date: "2026-05-23" }], TZ);

    // Event day stays even when occupied; time normalised to 17:00.
    expect(result).toHaveLength(1);
    expect(result[0]?.date).toBe("2026-05-23");
    expect(result[0]?.time).toBe("17:00");
  });

  it("returns all suggestions unchanged when no occupancy conflicts exist", () => {
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "a", date: "2026-05-10", label: "Weekly hype · 2 weeks out" }),
      suggestion({ id: "b", date: "2026-05-17", label: "Weekly hype · 1 week out" }),
      suggestion({ id: "c", date: "2026-05-22", label: "1 day to go" }),
      suggestion({ id: "d", date: "2026-05-23", label: "Event day" }),
    ];

    const result = deconflictSuggestions(suggestions, [], TZ);

    expect(result).toHaveLength(4);
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });
});
