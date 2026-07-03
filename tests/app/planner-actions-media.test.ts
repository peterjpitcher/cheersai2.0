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

function createSupabaseMock(results: QueryResult[]) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  let resultIndex = 0;

  function nextResult(): QueryResult {
    const result = results[resultIndex] ?? { data: null, error: null };
    resultIndex += 1;
    return result;
  }

  function createBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {};

    for (const method of [
      "select",
      "update",
      "delete",
      "insert",
      "upsert",
      "eq",
      "in",
      "is",
      "not",
      "limit",
      "returns",
    ]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    }

    builder.maybeSingle = vi.fn(() => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return Promise.resolve(nextResult());
    });

    builder.then = vi.fn((resolve, reject) => Promise.resolve(nextResult()).then(resolve, reject));

    return builder;
  }

  const supabase = {
    from: vi.fn((table: string) => {
      calls.push({ table, method: "from", args: [table] });
      return createBuilder(table);
    }),
  };

  return { supabase, calls };
}

describe("updatePlannerContentMedia", () => {
  const contentId = "11111111-1111-4111-8111-111111111111";
  const mediaIdA = "22222222-2222-4222-8222-222222222222";
  const mediaIdB = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    revalidatePathMock.mockReset();
  });

  it("updates variant media and content media attachments in order", async () => {
    const { supabase, calls } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: "account-1",
          placement: "feed",
          status: "scheduled",
        },
        error: null,
      },
      {
        data: [
          { id: mediaIdA, media_type: "image", processed_status: "ready", derived_variants: { square: "a.jpg" } },
          { id: mediaIdB, media_type: "video", processed_status: "ready", derived_variants: null },
        ],
        error: null,
      },
      {
        data: [{ id: mediaIdA }, { id: mediaIdB }],
        error: null,
      },
      { error: null },
      { error: null },
      { error: null },
      { error: null },
    ]);

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await updatePlannerContentMedia({
      contentId,
      media: [{ assetId: mediaIdA }, { assetId: mediaIdB }],
    });

    const variantUpsert = calls.find((call) => call.table === "content_variants" && call.method === "upsert");
    expect(variantUpsert?.args[0]).toEqual({
      content_item_id: contentId,
      media_ids: [mediaIdA, mediaIdB],
    });

    const attachmentInsert = calls.find((call) => call.table === "content_media_attachments" && call.method === "insert");
    expect(attachmentInsert?.args[0]).toEqual([
      { content_item_id: contentId, media_id: mediaIdA, position: 0 },
      { content_item_id: contentId, media_id: mediaIdB, position: 1 },
    ]);

    expect(revalidatePathMock).toHaveBeenCalledWith(`/planner/${contentId}`);
    expect(revalidatePathMock).toHaveBeenCalledWith("/planner");
  });

  it("rejects non-editable posts", async () => {
    const { supabase, calls } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: "account-1",
          placement: "feed",
          status: "posted",
        },
        error: null,
      },
    ]);

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "This post can no longer be edited.",
    );

    expect(calls.some((call) => call.table === "content_variants")).toBe(false);
  });

  it("rejects media that does not belong to the account", async () => {
    const { supabase } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: "account-1",
          placement: "feed",
          status: "scheduled",
        },
        error: null,
      },
      { data: [], error: null },
    ]);

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "Some media assets do not belong to this account.",
    );
  });

  it("rejects story videos", async () => {
    const { supabase } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: "account-1",
          placement: "story",
          status: "scheduled",
        },
        error: null,
      },
      {
        data: [{ id: mediaIdA, media_type: "video", processed_status: "ready", derived_variants: null }],
        error: null,
      },
    ]);

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "Stories support images only",
    );
  });

  it("rejects story images without a story derivative", async () => {
    const { supabase } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: "account-1",
          placement: "story",
          status: "scheduled",
        },
        error: null,
      },
      {
        data: [{ id: mediaIdA, media_type: "image", processed_status: "ready", derived_variants: {} }],
        error: null,
      },
    ]);

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "Selected media is still processing story derivatives. Try again once ready.",
    );
  });
});
