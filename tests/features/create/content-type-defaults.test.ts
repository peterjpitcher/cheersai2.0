import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { getContentTypeDefaults } from "@/features/create/content-type-defaults";

describe("getContentTypeDefaults", () => {
  it("pre-fills an event's venue with the brand's own default", () => {
    const defaults = getContentTypeDefaults("event", {
      defaultEventVenue: " The Anchor, Stanwell Moor Village ",
    });

    expect(defaults).toMatchObject({
      venue: "The Anchor, Stanwell Moor Village",
      placements: ["feed", "story"],
    });
  });

  it("leaves the venue blank when the brand has no default, never another brand's venue", () => {
    const defaults = getContentTypeDefaults("event", { defaultEventVenue: "" });

    expect(defaults).toMatchObject({ venue: "" });
  });

  it("keeps the other content types' starting values", () => {
    const now = DateTime.fromISO("2026-10-24T23:30:00Z");

    expect(getContentTypeDefaults("instant_post", { defaultEventVenue: "x" })).toEqual({ publishMode: "now" });
    expect(getContentTypeDefaults("story", { defaultEventVenue: "x" })).toEqual({});
    expect(getContentTypeDefaults("promotion", { defaultEventVenue: "x" })).toEqual({
      offerSummary: "",
      endDate: "",
      placements: ["feed"],
    });
    // 23:30 UTC on 24 October is 00:30 on 25 October in London (BST), so four weeks on
    // from the London date is 22 November.
    expect(getContentTypeDefaults("weekly_recurring", { defaultEventVenue: "x", now })).toEqual({
      daysOfWeek: [1],
      time: "12:00",
      endDate: "2026-11-22",
      placement: "feed",
    });
  });
});
