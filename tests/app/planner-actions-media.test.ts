import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const revalidatePathMock = vi.fn();
const listMediaAssetsMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/publishing/queue", () => ({
  enqueueAndDispatch: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/library/data", () => ({
  listMediaAssets: (...args: unknown[]) => listMediaAssetsMock(...args),
}));

type QueryResult = { data?: unknown; error?: unknown };

/**
 * Per-table result queues keyed by table name. Robust to added queries: inserting
 * a new query on one table no longer shifts every later table's results.
 */
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
      return Promise.resolve(nextFor(table));
    });

    builder.then = vi.fn((resolve, reject) => Promise.resolve(nextFor(table)).then(resolve, reject));

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
    listMediaAssetsMock.mockReset();
  });

  it("updates variant media and content media attachments in order", async () => {
    const { supabase, calls } = createSupabaseMock({
      content_items: [
        { data: { id: contentId, account_id: "account-1", placement: "feed", status: "scheduled" }, error: null },
        { error: null }, // updated_at bump
      ],
      content_variants: [
        { data: { media_ids: [] }, error: null }, // currently attached (none)
        { error: null }, // upsert
      ],
      media_assets: [
        {
          data: [
            { id: mediaIdA, media_type: "image", processed_status: "ready", derived_variants: { square: "a.jpg" } },
            { id: mediaIdB, media_type: "video", processed_status: "ready", derived_variants: null },
          ],
          error: null,
        },
      ],
      media_library: [{ data: [{ id: mediaIdA }, { id: mediaIdB }], error: null }],
      content_media_attachments: [{ error: null }, { error: null }], // delete, insert
    });

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

  it("loads hidden attached ids when opening the planner media library", async () => {
    listMediaAssetsMock.mockResolvedValue([{ id: mediaIdA }]);

    const { loadPlannerMediaLibrary } = await import("@/app/(app)/planner/actions");
    await expect(loadPlannerMediaLibrary({ includeAssetIds: [mediaIdA] })).resolves.toEqual([{ id: mediaIdA }]);

    expect(listMediaAssetsMock).toHaveBeenCalledWith({
      excludeTags: ["Tournament"],
      includeAssetIds: [mediaIdA],
    });
  });

  it("keeps an already-attached asset that is now hidden and not 'ready'", async () => {
    const { supabase, calls } = createSupabaseMock({
      content_items: [
        { data: { id: contentId, account_id: "account-1", placement: "feed", status: "draft" }, error: null },
        { error: null }, // updated_at bump
      ],
      content_variants: [
        { data: { media_ids: [mediaIdA] }, error: null }, // already attached
        { error: null }, // upsert
      ],
      media_assets: [
        {
          data: [
            // hidden + no longer "ready", but already attached, so still allowed
            { id: mediaIdA, media_type: "image", processed_status: "processing", derived_variants: { story: "s" } },
          ],
          error: null,
        },
      ],
      media_library: [{ data: [{ id: mediaIdA }], error: null }],
      content_media_attachments: [{ error: null }, { error: null }],
    });

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(
      updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] }),
    ).resolves.toMatchObject({ ok: true });

    const variantUpsert = calls.find((call) => call.table === "content_variants" && call.method === "upsert");
    expect(variantUpsert?.args[0]).toMatchObject({ content_item_id: contentId, media_ids: [mediaIdA] });
  });

  it("still rejects a newly-added asset that is not ready", async () => {
    const { supabase } = createSupabaseMock({
      content_items: [
        { data: { id: contentId, account_id: "account-1", placement: "feed", status: "draft" }, error: null },
      ],
      content_variants: [{ data: { media_ids: [mediaIdA] }, error: null }],
      media_assets: [
        {
          data: [
            { id: mediaIdA, media_type: "image", processed_status: "ready", derived_variants: { story: "s" } },
            { id: mediaIdB, media_type: "image", processed_status: "processing", derived_variants: {} },
          ],
          error: null,
        },
      ],
    });

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(
      updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }, { assetId: mediaIdB }] }),
    ).rejects.toThrow("Select ready media assets only.");
  });

  it("rejects non-editable posts", async () => {
    const { supabase, calls } = createSupabaseMock({
      content_items: [
        { data: { id: contentId, account_id: "account-1", placement: "feed", status: "posted" }, error: null },
      ],
    });

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "This post can no longer be edited.",
    );

    expect(calls.some((call) => call.table === "content_variants")).toBe(false);
  });

  it("rejects media that does not belong to the account", async () => {
    const { supabase } = createSupabaseMock({
      content_items: [
        { data: { id: contentId, account_id: "account-1", placement: "feed", status: "scheduled" }, error: null },
      ],
      content_variants: [{ data: { media_ids: [] }, error: null }],
      media_assets: [{ data: [], error: null }],
    });

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "Some media assets do not belong to this account.",
    );
  });

  it("rejects story videos", async () => {
    const { supabase } = createSupabaseMock({
      content_items: [
        { data: { id: contentId, account_id: "account-1", placement: "story", status: "scheduled" }, error: null },
      ],
      content_variants: [{ data: { media_ids: [] }, error: null }],
      media_assets: [
        { data: [{ id: mediaIdA, media_type: "video", processed_status: "ready", derived_variants: null }], error: null },
      ],
    });

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "Stories support images only",
    );
  });

  it("rejects story images without a story derivative", async () => {
    const { supabase } = createSupabaseMock({
      content_items: [
        { data: { id: contentId, account_id: "account-1", placement: "story", status: "scheduled" }, error: null },
      ],
      content_variants: [{ data: { media_ids: [] }, error: null }],
      media_assets: [
        { data: [{ id: mediaIdA, media_type: "image", processed_status: "ready", derived_variants: {} }], error: null },
      ],
    });

    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase });

    const { updatePlannerContentMedia } = await import("@/app/(app)/planner/actions");
    await expect(updatePlannerContentMedia({ contentId, media: [{ assetId: mediaIdA }] })).rejects.toThrow(
      "Selected media is still processing story derivatives. Try again once ready.",
    );
  });
});
