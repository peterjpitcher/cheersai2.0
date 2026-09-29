import { afterEach, describe, expect, it, vi } from "vitest";

import { DateTime } from "luxon";

import {
  buildEventSuggestions,
  buildPromotionSuggestions,
  deconflictSuggestions,
} from "@/features/create/schedule/suggestion-utils";
import type { SuggestedSlotDisplay } from "@/features/create/schedule/schedule-calendar";

const TZ = "Europe/London";

describe("buildEventSuggestions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts only the event-day suggestion at 07:00, with no planner to deconflict against", () => {
    // What the wizard shows a new venue: its planner is empty, so these
    // suggestions reach the calendar exactly as built.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T08:00:00.000Z")); // Mon 11 May, 09:00 BST

    const result = buildEventSuggestions({ startDate: "2026-05-23", startTime: "19:00", timezone: TZ });

    expect(result.map((slot) => [slot.label, slot.date, slot.time])).toEqual([
      ["Weekly hype · 1 week out", "2026-05-16", "12:00"],
      ["2 days to go", "2026-05-21", "12:00"],
      ["1 day to go", "2026-05-22", "12:00"],
      ["Event day", "2026-05-23", "07:00"],
    ]);
  });
});

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

  it("keeps Event day pinned to its date and time even when that day is occupied", () => {
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "event-day", date: "2026-05-23", time: "07:00", label: "Event day" }),
    ];

    const result = deconflictSuggestions(suggestions, [{ date: "2026-05-23" }], TZ);

    expect(result).toHaveLength(1);
    expect(result[0]?.date).toBe("2026-05-23");
    expect(result[0]?.time).toBe("07:00");
  });

  it("never changes a suggestion's time", () => {
    // Times are set where the suggestions are built (the event-day 07:00 in
    // event-cadence.ts). The wizard skips this function on an empty planner,
    // so a time rule living here would silently not apply there.
    const suggestions: SuggestedSlotDisplay[] = [
      suggestion({ id: "a", date: "2026-05-21", time: "12:00", label: "2 days to go" }),
      suggestion({ id: "b", date: "2026-05-22", time: "12:00", label: "1 day to go" }),
      suggestion({ id: "c", date: "2026-05-23", time: "07:00", label: "Event day" }),
    ];

    const result = deconflictSuggestions(suggestions, [{ date: "2026-05-20" }], TZ);

    expect(result.map((slot) => [slot.label, slot.time])).toEqual([
      ["2 days to go", "12:00"],
      ["1 day to go", "12:00"],
      ["Event day", "07:00"],
    ]);
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

// ---------------------------------------------------------------------------
// Offer (promotion) suggestions: one per London day, planner empty or not
// ---------------------------------------------------------------------------

describe("buildPromotionSuggestions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** An unrelated post, on a day none of the cases below suggests. */
  const UNRELATED_POST = [{ date: "2026-12-01" }];

  function asRows(slots: SuggestedSlotDisplay[]): string[][] {
    return slots.map((slot) => [slot.label, slot.date, slot.time]);
  }

  it.each([
    {
      name: "ends today",
      now: "2026-10-12T08:00:00.000Z", // Mon 12 Oct, 09:00 BST
      endDate: "2026-10-12",
      expected: [["Launch", "2026-10-12", "12:00"]],
    },
    {
      name: "ends tomorrow",
      now: "2026-10-12T08:00:00.000Z",
      endDate: "2026-10-13",
      expected: [
        ["Launch", "2026-10-12", "12:00"],
        ["Last chance", "2026-10-13", "12:00"],
      ],
    },
    {
      name: "ends in 3 days",
      now: "2026-10-12T08:00:00.000Z",
      endDate: "2026-10-15",
      expected: [
        ["Launch", "2026-10-12", "12:00"],
        ["Mid-run reminder", "2026-10-13", "12:00"],
        ["Last chance", "2026-10-15", "12:00"],
      ],
    },
    {
      name: "ends in 10 days",
      now: "2026-10-12T08:00:00.000Z",
      endDate: "2026-10-22",
      expected: [
        ["Launch", "2026-10-12", "12:00"],
        ["Mid-run reminder", "2026-10-17", "12:00"],
        ["Last chance", "2026-10-22", "12:00"],
      ],
    },
    {
      name: "ends in 30 days, across the clock change",
      now: "2026-10-12T08:00:00.000Z",
      endDate: "2026-11-11",
      expected: [
        ["Launch", "2026-10-12", "12:00"],
        ["Mid-run reminder", "2026-10-27", "12:00"],
        ["Last chance", "2026-11-11", "12:00"],
      ],
    },
    {
      // Sat 24 Oct, 09:00 BST; the offer ends on Sun 25 Oct, when the clocks go back.
      name: "ends on the day the clocks go back",
      now: "2026-10-24T08:00:00.000Z",
      endDate: "2026-10-25",
      expected: [
        ["Launch", "2026-10-24", "12:00"],
        ["Last chance", "2026-10-25", "12:00"],
      ],
    },
    {
      // Sun 25 Oct, 09:00 GMT: launched on the day the clocks go back.
      name: "starts on the day the clocks go back",
      now: "2026-10-25T09:00:00.000Z",
      endDate: "2026-10-26",
      expected: [
        ["Launch", "2026-10-25", "12:00"],
        ["Last chance", "2026-10-26", "12:00"],
      ],
    },
    {
      // Fri 23 Oct, 09:00 BST; three days that span the clock change.
      name: "runs over the clock change",
      now: "2026-10-23T08:00:00.000Z",
      endDate: "2026-10-26",
      expected: [
        ["Launch", "2026-10-23", "12:00"],
        ["Mid-run reminder", "2026-10-24", "12:00"],
        ["Last chance", "2026-10-26", "12:00"],
      ],
    },
  ])("offers one suggestion per day when the offer $name", ({ now, endDate, expected }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));

    const built = buildPromotionSuggestions({ endDate, timezone: TZ });

    expect(asRows(built)).toEqual(expected);
    // No two suggestions share a London date and time.
    const keys = built.map((slot) => `${slot.date}T${slot.time}`);
    expect(new Set(keys).size).toBe(keys.length);
    // The wizard shows these as built on an empty planner and deconflicts them
    // against a planner with posts: an unrelated post must change nothing.
    expect(deconflictSuggestions(built, UNRELATED_POST, TZ)).toEqual(built);
  });

  it("puts each suggestion at 12:00 London on its day, in BST and in GMT", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T08:00:00.000Z")); // Sat 24 Oct, 09:00 BST

    const built = buildPromotionSuggestions({ endDate: "2026-10-25", timezone: TZ });

    expect(
      built.map((slot) => DateTime.fromISO(`${slot.date}T${slot.time}`, { zone: TZ }).toUTC().toISO()),
    ).toEqual([
      "2026-10-24T11:00:00.000Z", // 12:00 BST
      "2026-10-25T12:00:00.000Z", // 12:00 GMT
    ]);
  });
});

describe("buildPromotionSuggestions with the offer's start and end dates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function asRows(slots: SuggestedSlotDisplay[]): string[][] {
    return slots.map((slot) => [slot.label, slot.date, slot.time]);
  }

  /** Tuesday 29 September 2026, 09:00 BST. */
  const TUESDAY_MORNING = "2026-09-29T08:00:00.000Z";

  it.each([
    {
      name: "starts next week: launches on the start date and spaces the reminder from it",
      now: TUESDAY_MORNING,
      startDate: "2026-10-05",
      endDate: "2026-10-15",
      expected: [
        ["Launch", "2026-10-05", "12:00"],
        ["Mid-run reminder", "2026-10-10", "12:00"],
        ["Last chance", "2026-10-15", "12:00"],
      ],
    },
    {
      name: "starts today: launches today, as with no start date",
      now: TUESDAY_MORNING,
      startDate: "2026-09-29",
      endDate: "2026-10-09",
      expected: [
        ["Launch", "2026-09-29", "12:00"],
        ["Mid-run reminder", "2026-10-04", "12:00"],
        ["Last chance", "2026-10-09", "12:00"],
      ],
    },
    {
      name: "has no start date: launches today",
      now: TUESDAY_MORNING,
      startDate: undefined,
      endDate: "2026-10-09",
      expected: [
        ["Launch", "2026-09-29", "12:00"],
        ["Mid-run reminder", "2026-10-04", "12:00"],
        ["Last chance", "2026-10-09", "12:00"],
      ],
    },
    {
      // The form sends a blank start date as "".
      name: "has a blank start date: launches today",
      now: TUESDAY_MORNING,
      startDate: "",
      endDate: "2026-10-09",
      expected: [
        ["Launch", "2026-09-29", "12:00"],
        ["Mid-run reminder", "2026-10-04", "12:00"],
        ["Last chance", "2026-10-09", "12:00"],
      ],
    },
    {
      name: "started last week and is still running: launches today",
      now: TUESDAY_MORNING,
      startDate: "2026-09-22",
      endDate: "2026-10-09",
      expected: [
        ["Launch", "2026-09-29", "12:00"],
        ["Mid-run reminder", "2026-10-04", "12:00"],
        ["Last chance", "2026-10-09", "12:00"],
      ],
    },
    {
      // The form and the server refuse this brief; a draft saved before that
      // rule falls back to launching today rather than after the offer ends.
      name: "has a start date after the end date: ignores the start date",
      now: TUESDAY_MORNING,
      startDate: "2026-10-20",
      endDate: "2026-10-09",
      expected: [
        ["Launch", "2026-09-29", "12:00"],
        ["Mid-run reminder", "2026-10-04", "12:00"],
        ["Last chance", "2026-10-09", "12:00"],
      ],
    },
    {
      name: "starts and ends on the same day next week: one launch post",
      now: TUESDAY_MORNING,
      startDate: "2026-10-06",
      endDate: "2026-10-06",
      expected: [["Launch", "2026-10-06", "12:00"]],
    },
    {
      name: "starts tomorrow and ends the day after: launch and last chance",
      now: TUESDAY_MORNING,
      startDate: "2026-09-30",
      endDate: "2026-10-01",
      expected: [
        ["Launch", "2026-09-30", "12:00"],
        ["Last chance", "2026-10-01", "12:00"],
      ],
    },
    {
      name: "ended yesterday: no suggestions",
      now: TUESDAY_MORNING,
      startDate: undefined,
      endDate: "2026-09-28",
      expected: [],
    },
    {
      name: "ends today: launches today",
      now: TUESDAY_MORNING,
      startDate: undefined,
      endDate: "2026-09-29",
      expected: [["Launch", "2026-09-29", "12:00"]],
    },
    {
      // 12:30 BST: today's 12:00 is inside the 15-minute rule, so nothing is left.
      name: "ends today and it is past noon: no suggestions",
      now: "2026-09-29T11:30:00.000Z",
      startDate: undefined,
      endDate: "2026-09-29",
      expected: [],
    },
    {
      // Mon 19 Oct, 09:00 BST. Starts Sat 24 Oct (BST), ends Wed 28 Oct (GMT).
      name: "starts before the clock change and ends after it",
      now: "2026-10-19T08:00:00.000Z",
      startDate: "2026-10-24",
      endDate: "2026-10-28",
      expected: [
        ["Launch", "2026-10-24", "12:00"],
        ["Mid-run reminder", "2026-10-26", "12:00"],
        ["Last chance", "2026-10-28", "12:00"],
      ],
    },
    {
      // Tue 20 Oct, 09:00 BST. Starts Sun 25 Oct, the day the clocks go back.
      name: "starts on the day the clocks go back",
      now: "2026-10-20T08:00:00.000Z",
      startDate: "2026-10-25",
      endDate: "2026-10-27",
      expected: [
        ["Launch", "2026-10-25", "12:00"],
        ["Mid-run reminder", "2026-10-26", "12:00"],
        ["Last chance", "2026-10-27", "12:00"],
      ],
    },
    {
      // 23:30 UTC on Sat 24 Oct is 00:30 BST on Sun 25 Oct in London, so an
      // offer that ended on the 24th has ended, although the UTC date is the 24th.
      name: "ended on the Saturday, just after midnight on the night the clocks go back",
      now: "2026-10-24T23:30:00.000Z",
      startDate: undefined,
      endDate: "2026-10-24",
      expected: [],
    },
  ])("offers the right posts when the offer $name", ({ now, startDate, endDate, expected }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));

    const built = buildPromotionSuggestions({ startDate, endDate, timezone: TZ });

    expect(asRows(built)).toEqual(expected);
    const keys = built.map((slot) => `${slot.date}T${slot.time}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts the launch at 12:00 London on a start date either side of the clock change", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T08:00:00.000Z")); // Mon 19 Oct, 09:00 BST

    const launchAt = (startDate: string) => {
      const [launch] = buildPromotionSuggestions({ startDate, endDate: "2026-10-30", timezone: TZ });
      return DateTime.fromISO(`${launch.date}T${launch.time}`, { zone: TZ }).toUTC().toISO();
    };

    expect(launchAt("2026-10-24")).toBe("2026-10-24T11:00:00.000Z"); // 12:00 BST
    expect(launchAt("2026-10-25")).toBe("2026-10-25T12:00:00.000Z"); // 12:00 GMT
  });
});
