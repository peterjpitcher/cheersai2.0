import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const createServiceSupabaseClientMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: createServiceSupabaseClientMock,
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
      "contains",
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

const oldAssetId = "11111111-1111-4111-8111-111111111111";
const newAssetId = "22222222-2222-4222-8222-222222222222";

function imageAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: oldAssetId,
    account_id: "account-1",
    storage_path: "account-1/old/image.png",
    file_name: "old.png",
    media_type: "image",
    mime_type: "image/png",
    size_bytes: 1234,
    tags: ["promo"],
    processed_status: "ready",
    processed_at: "2026-07-01T10:00:00.000Z",
    derived_variants: { square: "derived/old/square.jpg", story: "derived/old/story.jpg" },
    aspect_class: "square",
    ...overrides,
  };
}

describe("replaceMediaAssetEverywhere", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    createServiceSupabaseClientMock.mockReset();
    revalidatePathMock.mockReset();
    requireAuthContextMock.mockResolvedValue({ accountId: "account-1" });
  });

  it("replaces local references and hides the old image", async () => {
    const { supabase, calls } = createSupabaseMock([
      {
        data: [
          imageAsset({ id: oldAssetId }),
          imageAsset({
            id: newAssetId,
            storage_path: "account-1/new/image.png",
            file_name: "new.png",
            derived_variants: { square: "derived/new/square.jpg", story: "derived/new/story.jpg" },
          }),
        ],
        error: null,
      },
      { error: null },
      { data: [{ id: "variant-1", media_ids: [oldAssetId, "33333333-3333-4333-8333-333333333333", oldAssetId] }], error: null },
      { error: null },
      { data: [{ id: "attachment-1" }], error: null },
      { error: null },
      { error: null },
      { error: null },
      { error: null },
      { error: null },
      { error: null },
      { data: [{ id: "meta-campaign-1" }], error: null },
      { data: [{ id: "adset-1" }], error: null },
      { error: null },
      { error: null },
      { error: null },
    ]);
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await replaceMediaAssetEverywhere({ oldAssetId, newAssetId });

    const variantUpdate = calls.find((call) => call.table === "content_variants" && call.method === "update");
    expect(variantUpdate?.args[0]).toEqual({
      media_ids: [newAssetId, "33333333-3333-4333-8333-333333333333"],
    });

    const attachmentUpdate = calls.find((call) => call.table === "content_media_attachments" && call.method === "update");
    expect(attachmentUpdate?.args[0]).toEqual({ media_id: newAssetId });

    expect(calls.find((call) => call.table === "campaigns" && call.method === "update")?.args[0]).toMatchObject({
      hero_media_id: newAssetId,
    });
    expect(calls.find((call) => call.table === "link_in_bio_profiles" && call.method === "update")?.args[0]).toMatchObject({
      hero_media_id: newAssetId,
      hero_image_url: null,
    });
    expect(calls.find((call) => call.table === "link_in_bio_tiles" && call.method === "update")?.args[0]).toMatchObject({
      media_asset_id: newAssetId,
      image_url: null,
    });
    expect(calls.find((call) => call.table === "ad_sets" && call.method === "update")?.args[0]).toEqual({
      adset_media_asset_id: newAssetId,
      adset_image_url: null,
    });
    expect(calls.find((call) => call.table === "ads" && call.method === "update")?.args[0]).toEqual({
      media_asset_id: newAssetId,
      preview_url: null,
    });

    const tournamentUpdates = calls.filter((call) => call.table === "tournaments" && call.method === "update");
    expect(tournamentUpdates[0]?.args[0]).toMatchObject({ base_image_square_id: newAssetId });
    expect(tournamentUpdates[1]?.args[0]).toMatchObject({ base_image_story_id: newAssetId });

    const mediaAssetUpdates = calls.filter((call) => call.table === "media_assets" && call.method === "update");
    expect(mediaAssetUpdates.at(-1)?.args[0]).toMatchObject({ hidden_at: expect.any(String) });

    expect(revalidatePathMock).toHaveBeenCalledWith("/library");
    expect(revalidatePathMock).toHaveBeenCalledWith("/planner");
    expect(revalidatePathMock).toHaveBeenCalledWith("/campaigns");
    expect(revalidatePathMock).toHaveBeenCalledWith("/link-in-bio");
    expect(revalidatePathMock).toHaveBeenCalledWith("/tournaments");
  });

  it("rejects an original asset outside the account", async () => {
    const { supabase } = createSupabaseMock([
      { data: [imageAsset({ id: newAssetId })], error: null },
    ]);
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Original media was not found for this account.",
    );
  });

  it("rejects a replacement asset outside the account", async () => {
    const { supabase } = createSupabaseMock([
      { data: [imageAsset({ id: oldAssetId })], error: null },
    ]);
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Replacement media was not found for this account.",
    );
  });

  it("rejects video replacement assets", async () => {
    const { supabase } = createSupabaseMock([
      {
        data: [
          imageAsset({ id: oldAssetId }),
          imageAsset({ id: newAssetId, media_type: "video" }),
        ],
        error: null,
      },
    ]);
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Only image assets can be replaced with this flow.",
    );
  });

  it("rejects replacement images that are not ready", async () => {
    const { supabase } = createSupabaseMock([
      {
        data: [
          imageAsset({ id: oldAssetId }),
          imageAsset({ id: newAssetId, processed_status: "processing" }),
        ],
        error: null,
      },
    ]);
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Replacement image is still processing. Try again once ready.",
    );
  });
});
