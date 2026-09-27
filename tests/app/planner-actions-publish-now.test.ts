import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONTENT_ID = "0b6f5f4e-1c2d-4a3b-9e8f-7a6b5c4d3e2f";
const ACCOUNT_ID = "account-1";

const requireEntitledContextMock = vi.fn();
const readinessMock = vi.fn();
const enqueueMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: vi.fn(),
}));

vi.mock("@/lib/billing/entitlement-server", () => ({
  requireEntitledContext: requireEntitledContextMock,
}));

vi.mock("@/lib/publishing/preflight", () => ({
  getPublishReadinessIssues: readinessMock,
}));

vi.mock("@/lib/publishing/queue", () => ({
  enqueueAndDispatch: enqueueMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type QueryResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  op: "select" | "update" | "insert";
  payload?: Record<string, unknown>;
  filters: unknown[][];
}

/**
 * A Supabase stand-in that answers each table's queries in order and records
 * every write, so a test can assert what would reach the database.
 */
function createSupabaseMock(plan: Record<string, QueryResult[]>) {
  const cursors: Record<string, number> = {};
  const calls: RecordedCall[] = [];

  function nextFor(table: string): QueryResult {
    const queue = plan[table] ?? [];
    const index = cursors[table] ?? 0;
    cursors[table] = index + 1;
    return queue[index] ?? { data: null, error: null };
  }

  function createBuilder(table: string): Record<string, unknown> {
    const call: RecordedCall = { table, op: "select", filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "neq", "gte", "lte", "order", "limit", "returns"]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        call.filters.push([method, ...args]);
        return builder;
      });
    }
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      call.op = "update";
      call.payload = payload;
      return builder;
    });
    builder.insert = vi.fn((payload: Record<string, unknown>) => {
      call.op = "insert";
      call.payload = payload;
      return builder;
    });
    builder.maybeSingle = vi.fn(() => Promise.resolve(nextFor(table)));
    builder.then = vi.fn((resolve, reject) => Promise.resolve(nextFor(table)).then(resolve, reject));
    return builder;
  }

  return { client: { from: vi.fn((table: string) => createBuilder(table)) }, calls };
}

/** The queries a send-now makes, in order, for a post in `status`. */
function planFor(status: string, { timezone = "Europe/London", placement = "feed" } = {}) {
  const contentRow = {
    id: CONTENT_ID,
    status,
    placement,
    platform: "facebook",
    campaign_id: null,
    account_id: ACCOUNT_ID,
    prompt_context: null,
  };
  return {
    content_items: [
      { data: { id: CONTENT_ID, status }, error: null }, // publishPlannerContentNow's guard read
      { data: contentRow, error: null }, // updatePlannerContentSchedule's read
      ...(placement === "feed" ? [{ data: [], error: null }] : []), // same-day feed slots
      { data: null, error: null }, // the update
    ],
    accounts: [
      { data: { timezone }, error: null },
      { data: { timezone }, error: null },
    ],
    content_variants: [{ data: null, error: null }], // drift check: no copy to judge
    publish_jobs: [{ data: [{ id: "job-1" }], error: null }],
  };
}

async function publishNow(plan: Record<string, QueryResult[]>) {
  const supabase = createSupabaseMock(plan);
  requireEntitledContextMock.mockResolvedValue({ supabase: supabase.client, accountId: ACCOUNT_ID });
  const { publishPlannerContentNow } = await import("@/app/(app)/planner/actions");
  const result = await publishPlannerContentNow({ contentId: CONTENT_ID });
  return { result, supabase };
}

function writes(calls: RecordedCall[]) {
  return calls.filter((call) => call.op !== "select");
}

describe("publishPlannerContentNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Sunday 27 September 2026, 09:00:20 BST.
    vi.setSystemTime(new Date("2026-09-27T08:00:20.000Z"));
    readinessMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["scheduled", "failed"])("sends a %s post at the next whole minute through the schedule path", async (status) => {
    const { result, supabase } = await publishNow(planFor(status));

    expect(result).toMatchObject({ ok: true, scheduledFor: "2026-09-27T08:01:00.000Z", timezone: "Europe/London" });

    const contentUpdate = writes(supabase.calls).find((call) => call.table === "content_items");
    expect(contentUpdate?.payload).toMatchObject({ scheduled_for: "2026-09-27T08:01:00.000Z", status: "scheduled" });

    // The live worker only takes queued jobs whose next_attempt_at is due, so
    // the job must be re-queued with the new time and a clean slate.
    const jobUpdate = writes(supabase.calls).find((call) => call.table === "publish_jobs");
    expect(jobUpdate?.payload).toMatchObject({
      status: "queued",
      next_attempt_at: "2026-09-27T08:01:00.000Z",
      last_error: null,
      attempt: 0,
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("checks the 'publish' entitlement and scopes the post to the active brand", async () => {
    const { supabase } = await publishNow(planFor("scheduled"));

    expect(requireEntitledContextMock).toHaveBeenCalled();
    for (const [capability] of requireEntitledContextMock.mock.calls) {
      expect(capability).toBe("publish");
    }

    const guardRead = supabase.calls[0];
    expect(guardRead.table).toBe("content_items");
    expect(guardRead.filters).toContainEqual(["eq", "account_id", ACCOUNT_ID]);
    expect(guardRead.filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("stops before any read when the brand is not entitled to publish", async () => {
    requireEntitledContextMock.mockRejectedValue(new Error("Your subscription does not allow publishing."));
    const { publishPlannerContentNow } = await import("@/app/(app)/planner/actions");

    await expect(publishPlannerContentNow({ contentId: CONTENT_ID })).rejects.toThrow("does not allow publishing");
    expect(readinessMock).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", "Approve this draft before publishing it."],
    ["queued", "This post is already queued to go out."],
    ["publishing", "This post is being published now."],
    ["posted", "This post has already been published."],
    ["review", "This post cannot be published now."],
  ])("refuses a %s post, as the state machine does not allow it to move to queued", async (status, message) => {
    const { result, supabase } = await publishNow(planFor(status));

    expect(result).toEqual({ error: message });
    expect(writes(supabase.calls)).toHaveLength(0);
    expect(readinessMock).not.toHaveBeenCalled();
  });

  it("throws when the post is not in the active brand or is in Trash", async () => {
    const plan = { ...planFor("scheduled"), content_items: [{ data: null, error: null }] };

    await expect(publishNow(plan)).rejects.toThrow("Content item not found");
  });

  it("returns the preflight problems and writes nothing when the post is not ready", async () => {
    readinessMock.mockResolvedValue([{ code: "connection_missing", message: "Connect Facebook before scheduling this post." }]);

    const { result, supabase } = await publishNow(planFor("failed"));

    expect(result).toEqual({ error: "Connect Facebook before scheduling this post." });
    expect(writes(supabase.calls)).toHaveLength(0);
  });

  it("surfaces a database failure instead of reporting success", async () => {
    const plan: Record<string, QueryResult[]> = {
      ...planFor("scheduled"),
      publish_jobs: [{ data: null, error: { message: "connection reset" } }],
    };

    await expect(publishNow(plan)).rejects.toMatchObject({ message: "connection reset" });
  });

  // Stories, because a feed post's same-day slot search has its own clock-change
  // problem in updatePlannerContentSchedule, tracked separately. These pin how
  // the next-minute wall-clock time survives the round trip.
  describe("clock changes (Europe/London)", () => {
    const story = { placement: "story" };

    it("sends in the repeated hour after the clocks go back (second pass, GMT)", async () => {
      // 01:30:20 GMT on 25 October 2026: the second time 01:30 happens.
      vi.setSystemTime(new Date("2026-10-25T01:30:20.000Z"));

      const { result } = await publishNow(planFor("scheduled", story));

      expect(result).toMatchObject({ ok: true, scheduledFor: "2026-10-25T01:31:00.000Z" });
    });

    it("sends in the first pass of that hour, while still on BST", async () => {
      // 01:30:20 BST on 25 October 2026 is 00:30:20 UTC.
      vi.setSystemTime(new Date("2026-10-25T00:30:20.000Z"));

      const { result } = await publishNow(planFor("scheduled", story));

      expect(result).toMatchObject({ ok: true, scheduledFor: "2026-10-25T00:31:00.000Z" });
    });

    it("refuses at 01:59 BST, whose next minute is 01:00 GMT, and writes nothing", async () => {
      vi.setSystemTime(new Date("2026-10-25T00:59:30.000Z"));
      const supabase = createSupabaseMock(planFor("scheduled", story));
      requireEntitledContextMock.mockResolvedValue({ supabase: supabase.client, accountId: ACCOUNT_ID });
      const { publishPlannerContentNow } = await import("@/app/(app)/planner/actions");

      await expect(publishPlannerContentNow({ contentId: CONTENT_ID })).rejects.toThrow("already passed");
      expect(writes(supabase.calls)).toHaveLength(0);
    });

    it("sends across the spring-forward gap at 02:00 BST", async () => {
      // 00:59:30 GMT on 29 March 2026; the next minute is 02:00 BST.
      vi.setSystemTime(new Date("2026-03-29T00:59:30.000Z"));

      const { result } = await publishNow(planFor("scheduled", story));

      expect(result).toMatchObject({ ok: true, scheduledFor: "2026-03-29T01:00:00.000Z" });
    });
  });

  it("works out the minute in the brand's own timezone", async () => {
    const { result } = await publishNow(planFor("scheduled", { timezone: "America/New_York" }));

    expect(result).toMatchObject({ ok: true, scheduledFor: "2026-09-27T08:01:00.000Z", timezone: "America/New_York" });
  });
});
