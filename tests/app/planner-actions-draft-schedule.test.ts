import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A draft's publish job is armed at approval, never when its time changes.
 * The planner used to insert a queued job when a draft was rescheduled, and the
 * live publish worker then sent the unapproved draft at that time.
 */

const CONTENT_ID = "0b6f5f4e-1c2d-4a3b-9e8f-7a6b5c4d3e2f";

const requireAuthContextMock = vi.fn();
const readinessMock = vi.fn();
const enqueueMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
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
type Write = { table: string; op: "update" | "insert"; payload: Record<string, unknown>; filters: Array<[string, string, unknown]> };

// Live CHECK on publish_jobs.status (nbkjciurhvkfpcpatbnt, 2026-09-27).
const PUBLISH_JOB_STATUSES = new Set(["queued", "in_progress", "succeeded", "failed", "held"]);

/**
 * Reads come from a per-table queue in call order; writes are recorded with
 * their filters and answered from the same queue (an update that selects
 * returns the queued rows).
 */
function createSupabaseMock(plan: Record<string, QueryResult[]>) {
  const cursors: Record<string, number> = {};
  const writes: Write[] = [];
  const tablesTouched: string[] = [];

  function nextFor(table: string): QueryResult {
    const queue = plan[table] ?? [];
    const index = cursors[table] ?? 0;
    cursors[table] = index + 1;
    return queue[index] ?? { data: null, error: null };
  }

  function createBuilder(table: string): Record<string, unknown> {
    tablesTouched.push(table);
    let write: Write | null = null;
    const builder: Record<string, unknown> = {};
    const settle = (): QueryResult => {
      if (write) {
        if (table === "publish_jobs" && "status" in write.payload && !PUBLISH_JOB_STATUSES.has(String(write.payload.status))) {
          return { data: null, error: { code: "23514", message: "publish_jobs_status_check" } };
        }
        writes.push(write);
      }
      return nextFor(table);
    };
    for (const method of ["select", "neq", "gte", "lte", "order", "limit", "returns"]) {
      builder[method] = vi.fn(() => builder);
    }
    for (const method of ["eq", "in", "is"]) {
      builder[method] = vi.fn((column: string, value: unknown) => {
        write?.filters.push([method, column, value]);
        return builder;
      });
    }
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      write = { table, op: "update", payload, filters: [] };
      return builder;
    });
    builder.insert = vi.fn((payload: Record<string, unknown>) => {
      write = { table, op: "insert", payload, filters: [] };
      return builder;
    });
    builder.maybeSingle = vi.fn(() => Promise.resolve(settle()));
    builder.then = vi.fn((resolve, reject) => Promise.resolve(settle()).then(resolve, reject));
    return builder;
  }

  return { client: { from: vi.fn((table: string) => createBuilder(table)) }, writes, tablesTouched };
}

function contentRow(status: string, placement: "feed" | "story" = "feed") {
  return {
    id: CONTENT_ID,
    status,
    placement,
    platform: "facebook",
    campaign_id: null,
    account_id: "account-1",
    prompt_context: null,
    scheduled_for: "2026-09-29T11:00:00.000Z",
  };
}

async function loadActions() {
  return import("@/app/(app)/planner/actions");
}

describe("updatePlannerContentSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T09:00:00+01:00"));
    readinessMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a draft without arming a publish job, and says it still needs approval", async () => {
    const mock = createSupabaseMock({
      content_items: [
        { data: contentRow("draft"), error: null },
        { data: [], error: null }, // same-day feed slots
        { data: null, error: null }, // the update
      ],
      accounts: [{ data: { timezone: "Europe/London" }, error: null }],
      content_variants: [{ data: { body: "Sunday lunch is back this weekend." }, error: null }],
    });
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { updatePlannerContentSchedule } = await loadActions();
    const result = await updatePlannerContentSchedule({ contentId: CONTENT_ID, date: "2026-09-29", time: "12:30" });

    expect(result).toMatchObject({ ok: true, awaitingApproval: true, scheduledFor: "2026-09-29T11:30:00.000Z" });

    // The time is saved and the post stays a draft.
    const contentUpdate = mock.writes.find((write) => write.table === "content_items");
    expect(contentUpdate?.payload).toMatchObject({ scheduled_for: "2026-09-29T11:30:00.000Z" });
    expect(contentUpdate?.payload).not.toHaveProperty("status");
    expect(contentUpdate?.filters).toContainEqual(["eq", "id", CONTENT_ID]);

    // No job is created, and none is touched.
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(mock.tablesTouched).not.toContain("publish_jobs");
  });

  it("leaves a stopped job alone when a draft moves", async () => {
    // A draft that went back to draft (screening changed) still has its
    // failed job. Moving the draft must not put that job back in the queue.
    const mock = createSupabaseMock({
      content_items: [
        { data: contentRow("draft", "story"), error: null },
        { data: null, error: null },
      ],
      accounts: [{ data: { timezone: "Europe/London" }, error: null }],
      content_variants: [{ data: { body: "" }, error: null }],
      publish_jobs: [{ data: [{ id: "job-1" }], error: null }],
    });
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { updatePlannerContentSchedule } = await loadActions();
    await updatePlannerContentSchedule({ contentId: CONTENT_ID, date: "2026-09-29", time: "12:30" });

    expect(mock.tablesTouched).not.toContain("publish_jobs");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("still re-queues the job of a scheduled post at the new time", async () => {
    const mock = createSupabaseMock({
      content_items: [
        { data: contentRow("scheduled", "story"), error: null },
        { data: null, error: null },
      ],
      accounts: [{ data: { timezone: "Europe/London" }, error: null }],
      content_variants: [{ data: { body: "" }, error: null }],
      publish_jobs: [{ data: [{ id: "job-1", status: "queued" }], error: null }, { data: [{ id: "job-1" }], error: null }], // the job check, then the re-arm
    });
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { updatePlannerContentSchedule } = await loadActions();
    const result = await updatePlannerContentSchedule({ contentId: CONTENT_ID, date: "2026-09-29", time: "12:30" });

    expect(result).toMatchObject({ ok: true, awaitingApproval: false });
    const contentUpdate = mock.writes.find((write) => write.table === "content_items");
    expect(contentUpdate?.payload).toMatchObject({ status: "scheduled" });
    const jobUpdate = mock.writes.find((write) => write.table === "publish_jobs");
    expect(jobUpdate?.payload).toMatchObject({ status: "queued", next_attempt_at: "2026-09-29T11:30:00.000Z", attempt: 0, hold_reason: null, error_message: null, error_code: null });
    expect(jobUpdate?.filters).toContainEqual(["eq", "content_item_id", CONTENT_ID]);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("still creates a job for a scheduled post that has none", async () => {
    const mock = createSupabaseMock({
      content_items: [
        { data: contentRow("failed", "story"), error: null },
        { data: null, error: null },
      ],
      accounts: [{ data: { timezone: "Europe/London" }, error: null }],
      content_variants: [
        { data: { body: "" }, error: null }, // drift check
        { data: { id: "variant-1" }, error: null },
      ],
      publish_jobs: [{ data: [], error: null }],
    });
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { updatePlannerContentSchedule } = await loadActions();
    await updatePlannerContentSchedule({ contentId: CONTENT_ID, date: "2026-09-29", time: "12:30" });

    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({
      contentItemId: CONTENT_ID,
      scheduledAt: new Date("2026-09-29T11:30:00.000Z"),
    }));
  });
});

describe("approveDraftContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T09:00:00+01:00"));
    readinessMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function approvalPlan(jobs: Array<{ id: string; status: string }>) {
    return {
      content_items: [
        { data: contentRow("draft"), error: null },
        { data: null, error: null }, // status -> scheduled
      ],
      publish_jobs: [
        { data: jobs, error: null },
        { data: null, error: null }, // re-arm
      ],
      content_variants: [{ data: { id: "variant-1" }, error: null }],
      notifications: [{ data: null, error: null }],
    };
  }

  it("arms a new job at the draft's time when it has none", async () => {
    const mock = createSupabaseMock(approvalPlan([]));
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { approveDraftContent } = await loadActions();
    const result = await approveDraftContent({ contentId: CONTENT_ID });

    expect(result).toMatchObject({ status: "scheduled", scheduledFor: "2026-09-29T11:00:00.000Z" });
    const contentUpdate = mock.writes.find((write) => write.table === "content_items");
    expect(contentUpdate?.payload).toMatchObject({ status: "scheduled" });
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({
      contentItemId: CONTENT_ID,
      scheduledAt: new Date("2026-09-29T11:00:00.000Z"),
    }));
  });

  it.each(["failed", "held", "queued"])("re-arms a %s job left from before at the approved time", async (status) => {
    const mock = createSupabaseMock(approvalPlan([{ id: "job-1", status }]));
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { approveDraftContent } = await loadActions();
    await approveDraftContent({ contentId: CONTENT_ID });

    const rearm = mock.writes.find((write) => write.table === "publish_jobs");
    expect(rearm?.payload).toMatchObject({
      status: "queued",
      next_attempt_at: "2026-09-29T11:00:00.000Z",
      attempt: 0,
      last_error: null,
      error_message: null,
      error_code: null,
      hold_reason: null,
      resolved_at: null,
    });
    expect(rearm?.filters).toContainEqual(["in", "id", ["job-1"]]);
    expect(enqueueMock).not.toHaveBeenCalled();

    // The post is scheduled before its job goes back in the queue, so the
    // worker never sees a queued job on a draft.
    const order = mock.writes.map((write) => write.table);
    expect(order.indexOf("content_items")).toBeLessThan(order.indexOf("publish_jobs"));
  });

  it.each(["succeeded", "in_progress"])("never re-arms or duplicates a %s job", async (status) => {
    const mock = createSupabaseMock(approvalPlan([{ id: "job-1", status }]));
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { approveDraftContent } = await loadActions();
    await approveDraftContent({ contentId: CONTENT_ID });

    expect(mock.writes.filter((write) => write.table === "publish_jobs")).toEqual([]);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("fails loudly when the job lookup fails, rather than arming a duplicate", async () => {
    const mock = createSupabaseMock({
      ...approvalPlan([]),
      publish_jobs: [{ data: null, error: { message: "db down" } }],
    });
    requireAuthContextMock.mockResolvedValue({ supabase: mock.client, accountId: "account-1" });

    const { approveDraftContent } = await loadActions();
    await expect(approveDraftContent({ contentId: CONTENT_ID })).rejects.toMatchObject({ message: "db down" });
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
