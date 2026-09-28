import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONTENT_ID = "0b6f5f4e-1c2d-4a3b-9e8f-7a6b5c4d3e2f";

const requireAuthContextMock = vi.fn();
const readinessMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/publishing/preflight", () => ({
  getPublishReadinessIssues: readinessMock,
}));

vi.mock("@/lib/publishing/queue", () => ({
  enqueueAndDispatch: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type QueryResult = { data?: unknown; error?: unknown };

function createSupabaseMock(plan: Record<string, QueryResult[]>) {
  const cursors: Record<string, number> = {};

  function nextFor(table: string): QueryResult {
    const queue = plan[table] ?? [];
    const index = cursors[table] ?? 0;
    cursors[table] = index + 1;
    return queue[index] ?? { data: null, error: null };
  }

  function createBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "in", "is", "neq", "gte", "lte", "order", "limit", "returns"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(() => Promise.resolve(nextFor(table)));
    builder.then = vi.fn((resolve, reject) => Promise.resolve(nextFor(table)).then(resolve, reject));
    return builder;
  }

  return { from: vi.fn((table: string) => createBuilder(table)) };
}

/**
 * Save a feed post for `date` at `time` (London wall clock) while the given
 * UTC instants are already taken by other feed posts on the same platform.
 * Returns the UTC instant the action saved.
 */
async function saveFeedSchedule(date: string, time: string, takenUtc: string[] = []): Promise<string> {
  const supabase = createSupabaseMock({
    content_items: [
      {
        data: {
          id: CONTENT_ID,
          status: "scheduled",
          placement: "feed",
          platform: "facebook",
          campaign_id: null,
          account_id: "account-1",
          prompt_context: null,
        },
        error: null,
      },
      { data: takenUtc.map((scheduled_for) => ({ scheduled_for })), error: null }, // same-day feed posts
      { data: null, error: null }, // the update
    ],
    accounts: [{ data: { timezone: "Europe/London" }, error: null }],
    publish_jobs: [{ data: [{ id: "job-1", status: "queued" }], error: null }, { data: [{ id: "job-1" }], error: null }], // the job check, then the re-arm
  });
  requireAuthContextMock.mockResolvedValue({ supabase, accountId: "account-1" });
  readinessMock.mockResolvedValue([]);

  const { updatePlannerContentSchedule } = await import("@/app/(app)/planner/actions");
  const result = await updatePlannerContentSchedule({ contentId: CONTENT_ID, date, time });
  expect("ok" in result && result.ok).toBe(true);
  return (result as { scheduledFor: string }).scheduledFor;
}

describe("updatePlannerContentSchedule feed slot on clock-change days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T09:00:00+01:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("a free slot saves at the wall-clock time asked for", () => {
    it("on a normal day (10:00 BST)", async () => {
      expect(await saveFeedSchedule("2026-09-14", "10:00")).toBe("2026-09-14T09:00:00.000Z");
    });

    it("on 25 October 2026, when the clocks go back (10:00 GMT, not 09:00)", async () => {
      expect(await saveFeedSchedule("2026-10-25", "10:00")).toBe("2026-10-25T10:00:00.000Z");
    });

    it("on 28 March 2027, when the clocks go forward (10:00 BST, not 11:00)", async () => {
      expect(await saveFeedSchedule("2027-03-28", "10:00")).toBe("2027-03-28T09:00:00.000Z");
    });
  });

  describe("a taken slot moves to the next free wall-clock slot", () => {
    it("on a normal day, 10:00 taken moves to 10:30 BST", async () => {
      expect(await saveFeedSchedule("2026-09-14", "10:00", ["2026-09-14T09:00:00.000Z"])).toBe(
        "2026-09-14T09:30:00.000Z",
      );
    });

    it("on 25 October 2026, 10:00 GMT taken moves to 10:30 GMT", async () => {
      expect(await saveFeedSchedule("2026-10-25", "10:00", ["2026-10-25T10:00:00.000Z"])).toBe(
        "2026-10-25T10:30:00.000Z",
      );
    });

    it("on 28 March 2027, 10:00 BST taken moves to 10:30 BST", async () => {
      expect(await saveFeedSchedule("2027-03-28", "10:00", ["2027-03-28T09:00:00.000Z"])).toBe(
        "2027-03-28T09:30:00.000Z",
      );
    });
  });

  describe("the hour that does not exist on 28 March 2027", () => {
    it("is skipped, so a taken 02:00 BST is not double-booked", async () => {
      // 00:30 GMT and 02:00 BST are taken. 01:00 and 01:30 do not exist that
      // night; they must not be pushed on to 02:00 (taken) but skipped, so the
      // post lands at 02:30 BST.
      const taken = ["2027-03-28T00:30:00.000Z", "2027-03-28T01:00:00.000Z"];
      expect(await saveFeedSchedule("2027-03-28", "00:30", taken)).toBe("2027-03-28T01:30:00.000Z");
    });

    it("a time asked for inside it saves at the next real time (02:30 BST, not 03:30)", async () => {
      // 01:30 does not exist; Luxon reads it as 02:30 BST before the search starts.
      expect(await saveFeedSchedule("2027-03-28", "01:30")).toBe("2027-03-28T01:30:00.000Z");
    });
  });

  describe("the hour that happens twice on 25 October 2026", () => {
    it("moving on from 01:00 BST stays in BST (01:30 BST)", async () => {
      // Asked in September, 01:00 reads as the first (BST) 01:00.
      expect(await saveFeedSchedule("2026-10-25", "01:00", ["2026-10-25T00:00:00.000Z"])).toBe(
        "2026-10-25T00:30:00.000Z",
      );
    });

    it("moving on from 01:00 GMT stays in GMT and never lands in the past", async () => {
      // At the moment the clocks go back, 01:00 reads as the second (GMT)
      // 01:00. Moving on must give 01:30 GMT, not 01:30 BST, which is an hour
      // earlier and already gone.
      vi.setSystemTime(new Date("2026-10-25T01:00:00.000Z"));
      expect(await saveFeedSchedule("2026-10-25", "01:00", ["2026-10-25T01:00:00.000Z"])).toBe(
        "2026-10-25T01:30:00.000Z",
      );
    });
  });

  it("still refuses when no slot is left that day", async () => {
    const taken = ["2026-09-14T22:00:00.000Z", "2026-09-14T22:30:00.000Z"]; // 23:00 and 23:30 BST
    await expect(saveFeedSchedule("2026-09-14", "23:00", taken)).rejects.toThrow(
      "No open 30-minute slots remain on that day for this channel.",
    );
  });
});
