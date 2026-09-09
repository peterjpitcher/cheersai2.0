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

/** An event on Saturday 19 September 2026 at 7pm, as the wizard stores it. */
const EVENT_PROMPT_CONTEXT = {
  slotKey: "slot-1",
  placement: "story",
  brief: {
    contentType: "event",
    title: "Quiz Night",
    eventName: "Quiz Night",
    eventDate: "2026-09-19",
    eventTime: "19:00",
  },
};

function planFor(body: string) {
  return {
    content_items: [
      {
        data: {
          id: CONTENT_ID,
          status: "scheduled",
          placement: "story",
          platform: "instagram",
          campaign_id: null,
          account_id: "account-1",
          prompt_context: EVENT_PROMPT_CONTEXT,
        },
        error: null,
      },
      { data: null, error: null }, // the update
    ],
    accounts: [{ data: { timezone: "Europe/London" }, error: null }],
    content_variants: [{ data: { body }, error: null }],
    publish_jobs: [{ data: [{ id: "job-1" }], error: null }],
  };
}

async function reschedule(body: string, date: string, time: string) {
  const supabase = createSupabaseMock(planFor(body));
  requireAuthContextMock.mockResolvedValue({ supabase, accountId: "account-1" });
  readinessMock.mockResolvedValue([]);

  const { updatePlannerContentSchedule } = await import("@/app/(app)/planner/actions");
  return updatePlannerContentSchedule({ contentId: CONTENT_ID, date, time });
}

describe("updatePlannerContentSchedule temporal drift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T09:00:00+01:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warns when the move makes the copy's wording untrue, and still saves", () => {
    // Copy written for the day before the event, moved five days earlier.
    return reschedule("Quiz night is tomorrow at 7pm. Bring your team.", "2026-09-14", "10:00").then((result) => {
      expect("ok" in result && result.ok).toBe(true);
      expect(result).toHaveProperty("warning");
      expect((result as { warning: string | null }).warning).toContain('"tomorrow"');
      // Advisory, not a gate: the new time is saved regardless.
      expect((result as { scheduledFor: string }).scheduledFor).toContain("2026-09-14");
    });
  });

  it("says nothing when the copy uses the absolute date", () => {
    return reschedule(
      "Quiz night lands on Saturday 19th September at 7pm. Bring your team.",
      "2026-09-14",
      "10:00",
    ).then((result) => {
      expect((result as { warning: string | null }).warning).toBeNull();
    });
  });

  it("says nothing when the wording is still true at the new time", () => {
    return reschedule("Quiz night is tomorrow at 7pm. Bring your team.", "2026-09-18", "10:00").then((result) => {
      expect((result as { warning: string | null }).warning).toBeNull();
    });
  });

  it("saves the reschedule even when the copy cannot be read", () => {
    // A missing variant must not block the move, and must not be reported as
    // "checked and fine" either: no warning is shown because nothing was judged.
    const supabase = createSupabaseMock({
      ...planFor(""),
      content_variants: [{ data: null, error: { message: "boom" } }],
    });
    requireAuthContextMock.mockResolvedValue({ supabase, accountId: "account-1" });
    readinessMock.mockResolvedValue([]);

    return import("@/app/(app)/planner/actions")
      .then((mod) => mod.updatePlannerContentSchedule({ contentId: CONTENT_ID, date: "2026-09-14", time: "10:00" }))
      .then((result) => {
        expect("ok" in result && result.ok).toBe(true);
        expect((result as { warning: string | null }).warning).toBeNull();
      });
  });
});
