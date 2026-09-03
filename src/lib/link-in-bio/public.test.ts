import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

import { selectWebsiteEventCandidates, websiteEventsCacheTag } from "./public";
import type { ManagementEventListItem } from "@/lib/management-app/client";

const TZ = "Europe/London";
const NOW = DateTime.fromISO("2026-09-03T12:00:00", { zone: TZ });

function event(
  id: string,
  overrides: Partial<ManagementEventListItem> = {},
): ManagementEventListItem {
  return {
    id,
    name: `Event ${id}`,
    slug: `event-${id}`,
    date: "2026-09-10",
    time: "19:00",
    event_status: "scheduled",
    ...overrides,
  };
}

describe("selectWebsiteEventCandidates", () => {
  it("returns an empty list when given nothing", () => {
    expect(selectWebsiteEventCandidates([], TZ, NOW)).toEqual([]);
  });

  it("keeps upcoming events", () => {
    const list = [event("a"), event("b", { date: "2026-09-11" })];
    expect(selectWebsiteEventCandidates(list, TZ, NOW).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("sorts by start time, not by list order", () => {
    const list = [
      event("late", { date: "2026-09-20" }),
      event("early", { date: "2026-09-04" }),
      event("middle", { date: "2026-09-12" }),
    ];
    expect(selectWebsiteEventCandidates(list, TZ, NOW).map((e) => e.id)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });

  it("drops events that started more than four hours ago", () => {
    const list = [
      event("stale", { date: "2026-09-03", time: "07:00" }),
      event("recent", { date: "2026-09-03", time: "09:30" }),
      event("future", { date: "2026-09-04", time: "19:00" }),
    ];
    // 07:00 is five hours before NOW, 09:30 is two and a half.
    expect(selectWebsiteEventCandidates(list, TZ, NOW).map((e) => e.id)).toEqual([
      "recent",
      "future",
    ]);
  });

  it("drops events whose status is not publicly visible", () => {
    const list = [
      event("cancelled", { event_status: "cancelled" }),
      event("draft", { event_status: "draft" }),
      event("archived", { event_status: "archived" }),
      event("live", { event_status: "scheduled" }),
    ];
    expect(selectWebsiteEventCandidates(list, TZ, NOW).map((e) => e.id)).toEqual(["live"]);
  });

  it("treats a missing status as visible", () => {
    const list = [event("a", { event_status: null })];
    expect(selectWebsiteEventCandidates(list, TZ, NOW).map((e) => e.id)).toEqual(["a"]);
  });

  it("drops events with no usable start time", () => {
    const list = [
      event("undated", { date: null, startDate: null }),
      event("nonsense", { date: "not-a-date", startDate: null }),
      event("ok"),
    ];
    expect(selectWebsiteEventCandidates(list, TZ, NOW).map((e) => e.id)).toEqual(["ok"]);
  });

  it("prefers an explicit startDate over date and time", () => {
    const list = [
      event("explicit", { startDate: "2026-09-04T18:00:00+01:00", date: "2026-12-25" }),
      event("derived", { date: "2026-09-05" }),
    ];
    expect(selectWebsiteEventCandidates(list, TZ, NOW).map((e) => e.id)).toEqual([
      "explicit",
      "derived",
    ]);
  });

  it("de-duplicates repeated ids, keeping the first", () => {
    const list = [event("dupe"), event("dupe", { date: "2026-09-30" }), event("other")];
    const result = selectWebsiteEventCandidates(list, TZ, NOW);
    expect(result.filter((e) => e.id === "dupe")).toHaveLength(1);
    expect(result.map((e) => e.id)).toEqual(["dupe", "other"]);
  });

  it("caps the list so a long feed does not cause one detail fetch per event", () => {
    // The whole point of the change: 30 listed events must not mean 30 round trips.
    const list = Array.from({ length: 30 }, (_, i) =>
      event(`e${i}`, { date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    const result = selectWebsiteEventCandidates(list, TZ, NOW);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.length).toBeLessThan(list.length);
  });

  it("fetches more than it renders, so detail-stage drops are backfilled", () => {
    // Six are rendered. Asking for exactly six would leave a short list whenever
    // detail data disqualifies one, so a buffer is fetched on purpose.
    const list = Array.from({ length: 20 }, (_, i) =>
      event(`e${i}`, { date: "2026-09-10", time: `${String(9 + (i % 12)).padStart(2, "0")}:00` }),
    );
    expect(selectWebsiteEventCandidates(list, TZ, NOW).length).toBeGreaterThan(6);
  });
});

describe("websiteEventsCacheTag", () => {
  it("is scoped per account so one brand cannot bust another's cache", () => {
    expect(websiteEventsCacheTag("acc-1")).toBe("link-in-bio:website-events:acc-1");
    expect(websiteEventsCacheTag("acc-1")).not.toBe(websiteEventsCacheTag("acc-2"));
  });
});
