import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/publishing/queue", () => ({
  enqueueAndDispatch: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

type QueryResult = { data?: unknown; error?: unknown };

function createSupabaseMock(plan: Record<string, QueryResult[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const cursors: Record<string, number> = {};

  function nextFor(table: string): QueryResult {
    const queue = plan[table] ?? [];
    const index = cursors[table] ?? 0;
    cursors[table] = index + 1;
    return queue[index] ?? { data: null, error: null };
  }

  function createBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {};

    for (const method of ["select", "update", "eq", "in", "returns"]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    }

    builder.maybeSingle = vi.fn(() => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return Promise.resolve(nextFor(table));
    });

    builder.then = vi.fn((resolve, reject) => Promise.resolve(nextFor(table)).then(resolve, reject));

    return builder;
  }

  const supabase = {
    from: vi.fn((table: string) => createBuilder(table)),
  };

  return { supabase, calls };
}

/** The payload written to content_variants, if any. */
function updatePayload(calls: Array<{ table: string; method: string; args: unknown[] }>) {
  return calls.find((c) => c.table === "content_variants" && c.method === "update")?.args[0] as
    | Record<string, unknown>
    | undefined;
}

describe("updatePlannerBannerConfig", () => {
  const contentItemId = "11111111-1111-4111-8111-111111111111";

  function stub(status = "scheduled") {
    const mock = createSupabaseMock({
      content_items: [{ data: { id: contentItemId, account_id: "account-1", status }, error: null }],
      content_variants: [{ error: null }],
    });
    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase: mock.supabase });
    return mock;
  }

  const base = {
    contentItemId,
    position: null,
    bgColour: null,
    textColour: null,
  };

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    revalidatePathMock.mockReset();
  });

  it("turns the strip ON with no text so the computed label prints", async () => {
    // Enabled-but-blank is the state event posts get at creation. Without it
    // there is no way back to the automatic label once a post has lost it.
    const { calls } = stub();

    const { updatePlannerBannerConfig } = await import("@/app/(app)/planner/actions");
    const result = await updatePlannerBannerConfig({ ...base, enabled: true, textOverride: null });

    expect(result.success).toBe(true);
    expect(updatePayload(calls)).toMatchObject({
      banner_enabled: true,
      banner_text_override: null,
    });
  });

  it("turns the strip OFF even when text is still in the box", async () => {
    const { calls } = stub();

    const { updatePlannerBannerConfig } = await import("@/app/(app)/planner/actions");
    await updatePlannerBannerConfig({ ...base, enabled: false, textOverride: "BANK HOLIDAY" });

    // Text is dropped alongside the flag so the two can never disagree.
    expect(updatePayload(calls)).toMatchObject({
      banner_enabled: false,
      banner_text_override: null,
    });
  });

  it("falls back to deriving the flag from the text when no choice is sent", async () => {
    const { calls } = stub();

    const { updatePlannerBannerConfig } = await import("@/app/(app)/planner/actions");
    await updatePlannerBannerConfig({ ...base, enabled: null, textOverride: "LATE DEAL" });

    expect(updatePayload(calls)).toMatchObject({
      banner_enabled: true,
      banner_text_override: "LATE DEAL",
    });
  });

  it("stays off when no choice is sent and the text is blank", async () => {
    const { calls } = stub();

    const { updatePlannerBannerConfig } = await import("@/app/(app)/planner/actions");
    await updatePlannerBannerConfig({ ...base, enabled: null, textOverride: null });

    expect(updatePayload(calls)).toMatchObject({ banner_enabled: false });
  });

  it("rejects disallowed overlay characters before writing anything", async () => {
    const { calls } = stub();

    const { updatePlannerBannerConfig } = await import("@/app/(app)/planner/actions");
    const result = await updatePlannerBannerConfig({
      ...base,
      enabled: true,
      textOverride: "QUIZ \u{1F389}",
    });

    expect(result.error).toBeTruthy();
    expect(updatePayload(calls)).toBeUndefined();
  });

  it("refuses to edit a post that has already published", async () => {
    const { calls } = stub("posted");

    const { updatePlannerBannerConfig } = await import("@/app/(app)/planner/actions");
    const result = await updatePlannerBannerConfig({ ...base, enabled: true, textOverride: null });

    expect(result.error).toBe("This post can no longer be edited.");
    expect(updatePayload(calls)).toBeUndefined();
  });
});
