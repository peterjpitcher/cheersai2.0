import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONTENT_ID = "4c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

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

/** Answers each table's queries in order and records every update. */
function createSupabaseMock(plan: Record<string, QueryResult[]>) {
  const cursors: Record<string, number> = {};
  const updates: Array<{ table: string; values: unknown }> = [];

  function nextFor(table: string): QueryResult {
    const queue = plan[table] ?? [];
    const index = cursors[table] ?? 0;
    cursors[table] = index + 1;
    return queue[index] ?? { data: null, error: null };
  }

  function createBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "neq", "gte", "lte", "order", "limit", "returns"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.update = vi.fn((values: unknown) => {
      updates.push({ table, values });
      return builder;
    });
    builder.maybeSingle = vi.fn(() => Promise.resolve(nextFor(table)));
    builder.then = vi.fn((resolve, reject) => Promise.resolve(nextFor(table)).then(resolve, reject));
    return builder;
  }

  return { client: { from: vi.fn((table: string) => createBuilder(table)) }, updates };
}

const promptContext = {
  slotKey: "cadence:2026-11-20",
  brief: {
    eventName: "Christmas Jackpot Cash Bingo",
    promotionWindow: { opensOn: "2026-11-19", afterEvent: "Snowball Showdown", afterDate: "2026-11-18", category: "Cash Bingo" },
  },
};

async function moveStory(date: string) {
  const { client, updates } = createSupabaseMock({
    content_items: [
      {
        data: {
          id: CONTENT_ID,
          status: "scheduled",
          placement: "story",
          platform: "instagram",
          campaign_id: "campaign-1",
          account_id: "account-1",
          prompt_context: promptContext,
        },
        error: null,
      },
      { data: null, error: null }, // the update
    ],
    accounts: [{ data: { timezone: "Europe/London" }, error: null }],
    publish_jobs: [{ data: [{ id: "job-1", status: "queued" }], error: null }, { data: [{ id: "job-1" }], error: null }],
  });
  requireAuthContextMock.mockResolvedValue({ supabase: client, accountId: "account-1" });
  readinessMock.mockResolvedValue([]);

  const { updatePlannerContentSchedule } = await import("@/app/(app)/planner/actions");
  const result = await updatePlannerContentSchedule({ contentId: CONTENT_ID, date, time: "11:00" });
  return { result, updates };
}

describe("updatePlannerContentSchedule and the event-order rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T10:00:00+01:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses to move a post before its promotion window, changing nothing", async () => {
    const { result, updates } = await moveStory("2026-11-18");

    expect(result).toEqual({
      error:
        "Christmas Jackpot Cash Bingo can be promoted from Thursday 19th November, after the last Cash Bingo (Snowball Showdown) on Wednesday 18th November.",
    });
    expect(updates).toEqual([]);
    expect(readinessMock).not.toHaveBeenCalled();
  });

  it("moves it on the day the window opens", async () => {
    const { result } = await moveStory("2026-11-19");

    expect(result).toMatchObject({ ok: true, scheduledFor: "2026-11-19T11:00:00.000Z" });
  });
});
