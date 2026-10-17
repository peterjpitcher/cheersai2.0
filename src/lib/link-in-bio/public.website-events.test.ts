// The link-in-bio "What's on" list must be current for every visitor
// (tasks/SPEC-link-in-bio-freshness.md). It used to sit in a
// stale-while-revalidate cache, so on a page seen about once every two days
// most visitors got a list from an earlier visit: past events at the top, new
// ones missing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagementEventDetail, ManagementEventListItem } from "@/lib/management-app/client";

const management = vi.hoisted(() => ({
  listManagementEvents: vi.fn(),
  getManagementEventDetail: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// What the two lookups before the management call return: the brand's import
// switch (accounts) and its connection (management_app_connections).
const db = vi.hoisted(() => ({
  importEnabled: true as boolean | null,
  switchError: null as { message: string } | null,
  connection: null as Record<string, unknown> | null,
  connectionError: null as { message: string } | null,
}));

vi.mock("@/lib/management-app/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/management-app/client")>()),
  listManagementEvents: management.listManagementEvents,
  getManagementEventDetail: management.getManagementEventDetail,
}));

vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  createLogger: () => logger,
}));

vi.mock("@/lib/supabase/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service")>()),
  tryCreateServiceSupabaseClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "accounts") {
              return db.switchError
                ? { data: null, error: db.switchError }
                : { data: { management_import_enabled: db.importEnabled }, error: null };
            }
            if (table === "management_app_connections") {
              return db.connectionError
                ? { data: null, error: db.connectionError }
                : { data: db.connection, error: null };
            }
            throw new Error(`unexpected table ${table}`);
          },
        }),
      }),
    }),
  }),
}));

import { getPublicWebsiteEvents } from "./public";

const TZ = "Europe/London";
const WEBSITE = "https://the-anchor.pub";

function listItem(id: string, name: string, startDate: string): ManagementEventListItem {
  return { id, name, slug: id, startDate, event_status: "scheduled" };
}

// Live events from the management app (17 October 2026). Times are UTC, as the
// management app sends them; 7 and 16 October are in British Summer Time.
const QUIZ = listItem("quiz", "A Hint of Halloween Quiz Night", "2026-10-07T18:00:00.000Z");
const BINGO = listItem("bingo", "Screams & Soundtracks Music Bingo", "2026-10-16T18:00:00.000Z");
const PARTY = listItem("party", "House of Horrors Halloween Party", "2026-10-31T20:00:00.000Z");

/** The management app's current list. Details answer for whatever it lists. */
let listed: ManagementEventListItem[] = [];

function managementLists(...items: ManagementEventListItem[]): void {
  listed = items;
  management.listManagementEvents.mockResolvedValue(items);
}

function managementFails(): void {
  management.listManagementEvents.mockRejectedValue(new Error("Management API request timed out."));
}

function detailFor(eventId: string): ManagementEventDetail {
  const item = listed.find((entry) => entry.id === eventId);
  if (!item) throw new Error(`no detail for ${eventId}`);
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    startDate: item.startDate,
    heroImageUrl: `https://images.example/${item.id}.jpg`,
    linkInBioShortLink: `https://l.the-anchor.pub/${item.id}`,
  };
}

function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

async function namesShown(accountId: string): Promise<string[]> {
  const events = await getPublicWebsiteEvents(accountId, TZ, WEBSITE);
  return events.map((event) => event.name);
}

// The last good list is kept per brand for the life of the server instance, so
// each test uses a brand of its own rather than resetting module state.
let brandCounter = 0;
let brand: string;

beforeEach(() => {
  brandCounter += 1;
  brand = `brand-${brandCounter}`;
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-10-07T11:00:00.000Z"); // 12:00 BST on 7 October
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.importEnabled = true;
  db.switchError = null;
  db.connection = { base_url: "https://management.example", api_key: "test-key", enabled: true };
  db.connectionError = null;
  listed = [];
  management.getManagementEventDetail.mockImplementation(async (_config: unknown, eventId: string) =>
    detailFor(eventId));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getPublicWebsiteEvents: fresh for every visitor", () => {
  it("shows the management app's list as it is now, not a copy from an earlier visit", async () => {
    managementLists(QUIZ, BINGO);
    expect(await namesShown(brand)).toEqual([QUIZ.name, BINGO.name]);

    // Two days later the quiz is over and the party has been added.
    at("2026-10-09T11:00:00.000Z");
    managementLists(BINGO, PARTY);
    expect(await namesShown(brand)).toEqual([BINGO.name, PARTY.name]);
    expect(management.listManagementEvents).toHaveBeenCalledTimes(2);
  });

  it("reuses one fetch for under a minute, then fetches again", async () => {
    managementLists(QUIZ);
    await namesShown(brand);
    at("2026-10-07T11:00:59.000Z");
    await namesShown(brand);
    expect(management.listManagementEvents).toHaveBeenCalledTimes(1);

    at("2026-10-07T11:01:00.000Z");
    await namesShown(brand);
    expect(management.listManagementEvents).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch between renders that arrive together", async () => {
    managementLists(QUIZ, BINGO);
    const shown = await Promise.all([namesShown(brand), namesShown(brand), namesShown(brand)]);
    expect(shown).toEqual([
      [QUIZ.name, BINGO.name],
      [QUIZ.name, BINGO.name],
      [QUIZ.name, BINGO.name],
    ]);
    expect(management.listManagementEvents).toHaveBeenCalledTimes(1);
  });

  it("keeps each brand's list to that brand", async () => {
    const otherBrand = `${brand}-other`;
    managementLists(QUIZ);
    expect(await namesShown(brand)).toEqual([QUIZ.name]);
    managementLists(PARTY);
    expect(await namesShown(otherBrand)).toEqual([PARTY.name]);
    expect(await namesShown(brand)).toEqual([QUIZ.name]);
  });

  it("gives every management call the short timeout", async () => {
    managementLists(QUIZ);
    await namesShown(brand);
    expect(management.listManagementEvents.mock.calls[0][0]).toMatchObject({ timeoutMs: 2_500 });
    expect(management.getManagementEventDetail.mock.calls[0][0]).toMatchObject({ timeoutMs: 2_500 });
  });

  it("keeps the London start time, with its offset, in summer and in winter", async () => {
    managementLists(
      QUIZ,
      { id: "derived", name: "Date and time only", date: "2026-10-16", time: "19:00", event_status: "scheduled" },
      PARTY,
    );
    management.getManagementEventDetail.mockRejectedValue(new Error("no detail"));
    const events = await getPublicWebsiteEvents(brand, TZ, WEBSITE);
    expect(events.map((event) => event.startsAt)).toEqual([
      "2026-10-07T19:00:00.000+01:00",
      "2026-10-16T19:00:00.000+01:00",
      "2026-10-31T20:00:00.000+00:00",
    ]);
  });

  it("still lists an event whose detail call fails, without its picture", async () => {
    managementLists(QUIZ);
    management.getManagementEventDetail.mockRejectedValue(new Error("Management API request timed out."));
    const [event] = await getPublicWebsiteEvents(brand, TZ, WEBSITE);
    expect(event).toMatchObject({ name: QUIZ.name, imageUrl: null, ctaUrl: `${WEBSITE}/events/quiz` });
  });
});

describe("getPublicWebsiteEvents: when the management app fails", () => {
  it("shows the last good list, without events that have since passed", async () => {
    managementLists(QUIZ, BINGO, PARTY);
    await namesShown(brand);

    // The next morning the quiz is long over and the management app is down.
    at("2026-10-08T09:00:00.000Z");
    managementFails();
    expect(await namesShown(brand)).toEqual([BINGO.name, PARTY.name]);
    expect(logger.warn).toHaveBeenCalledWith(
      "management events fetch failed; showing the last good list",
      expect.objectContaining({ accountId: brand, lastGoodAgeSeconds: 79_200 }),
    );
  });

  it("remembers more than the page shows, so passed events are backfilled", async () => {
    const eight = [
      listItem("e1", "7 October", "2026-10-07T18:00:00.000Z"),
      listItem("e2", "14 October", "2026-10-14T18:00:00.000Z"),
      listItem("e3", "21 October", "2026-10-21T18:00:00.000Z"),
      listItem("e4", "28 October", "2026-10-28T19:00:00.000Z"),
      listItem("e5", "4 November", "2026-11-04T19:00:00.000Z"),
      listItem("e6", "11 November", "2026-11-11T19:00:00.000Z"),
      listItem("e7", "18 November", "2026-11-18T19:00:00.000Z"),
      listItem("e8", "25 November", "2026-11-25T19:00:00.000Z"),
    ];
    managementLists(...eight);
    expect(await namesShown(brand)).toHaveLength(6);

    // A fortnight on, the first three are over and the management app is down.
    at("2026-10-22T09:00:00.000Z");
    managementFails();
    expect(await namesShown(brand)).toEqual([
      "28 October",
      "4 November",
      "11 November",
      "18 November",
      "25 November",
    ]);
  });

  it("shows no events, and logs it, when nothing has been fetched before", async () => {
    managementFails();
    expect(await namesShown(brand)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "management events fetch failed; showing no events",
      expect.objectContaining({ accountId: brand, lastGoodAgeSeconds: null }),
    );
  });

  it("logs one warning per failed fetch, however many renders shared it", async () => {
    managementFails();
    // The metadata and the page of one request are two renders.
    expect(await Promise.all([namesShown(brand), namesShown(brand)])).toEqual([[], []]);
    expect(management.listManagementEvents).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("goes back to the management app's list as soon as it answers again", async () => {
    managementLists(QUIZ);
    await namesShown(brand);

    at("2026-10-07T11:05:00.000Z");
    managementFails();
    expect(await namesShown(brand)).toEqual([QUIZ.name]);

    at("2026-10-07T11:10:00.000Z");
    managementLists(QUIZ, PARTY);
    expect(await namesShown(brand)).toEqual([QUIZ.name, PARTY.name]);
  });
});

describe("getPublicWebsiteEvents: the brand's import switch still fails closed", () => {
  it.each([
    ["the import switch", () => { db.switchError = { message: "connection reset" }; }],
    ["the management connection", () => { db.connectionError = { message: "connection reset" }; }],
  ])("shows nothing, and ignores the last good list, when %s cannot be read", async (_label, breakLookup) => {
    managementLists(QUIZ);
    expect(await namesShown(brand)).toEqual([QUIZ.name]);

    at("2026-10-07T11:05:00.000Z");
    breakLookup();
    expect(await namesShown(brand)).toEqual([]);
    expect(management.listManagementEvents).toHaveBeenCalledTimes(1);
  });

  it("makes no management calls when the switch is off, and forgets the earlier list", async () => {
    managementLists(QUIZ);
    expect(await namesShown(brand)).toEqual([QUIZ.name]);

    at("2026-10-07T11:05:00.000Z");
    db.importEnabled = false;
    expect(await namesShown(brand)).toEqual([]);
    expect(management.listManagementEvents).toHaveBeenCalledTimes(1);

    // Switched back on while the management app is down: the list from before
    // the switch went off is not brought back.
    at("2026-10-07T11:10:00.000Z");
    db.importEnabled = true;
    managementFails();
    expect(await namesShown(brand)).toEqual([]);
  });

  it("shows nothing when the brand has no enabled connection", async () => {
    db.connection = { base_url: "https://management.example", api_key: "test-key", enabled: false };
    managementLists(QUIZ);
    expect(await namesShown(brand)).toEqual([]);
    expect(management.listManagementEvents).not.toHaveBeenCalled();
  });
});
