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

/**
 * Per-table result queues. Each table name maps to the ordered list of results
 * its terminal awaits (`.then` / `.maybeSingle`) should resolve to. This is far
 * more robust than a single positional queue: adding a query to one table no
 * longer shifts every later table's results.
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

const oldAssetId = "11111111-1111-4111-8111-111111111111";
const newAssetId = "22222222-2222-4222-8222-222222222222";
const otherAssetId = "33333333-3333-4333-8333-333333333333";

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

const assetSelectResult: QueryResult = {
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
};

/**
 * Full happy-path plan: one variant, one attachment (no collision), one match on
 * every config surface, and zero remaining references at the gate (so the old
 * asset is hidden). Tests clone and tweak individual table queues.
 */
function happyPathPlan(): Record<string, QueryResult[]> {
  return {
    media_assets: [
      assetSelectResult, // initial select
      { error: null }, // hide update
    ],
    media_library: [{ error: null }], // sync upsert
    content_variants: [
      { data: [{ id: "variant-1", media_ids: [oldAssetId, otherAssetId, oldAssetId] }], error: null }, // select
      { error: null }, // update
      { data: [], error: null }, // gate: remaining references
    ],
    content_media_attachments: [
      { data: [{ id: "attachment-1", content_item_id: "item-1" }], error: null }, // select old
      { data: [], error: null }, // select content items already holding new (none)
      { data: [{ id: "attachment-1" }], error: null }, // update re-point
      { data: [], error: null }, // gate: remaining references
    ],
    campaigns: [{ data: [{ id: "campaign-1" }], error: null }],
    link_in_bio_profiles: [{ data: [{ id: "profile-1" }], error: null }],
    link_in_bio_tiles: [{ data: [{ id: "tile-1" }], error: null }],
    tournaments: [
      { data: [{ id: "tournament-square" }], error: null },
      { data: [{ id: "tournament-story" }], error: null },
    ],
    meta_campaigns: [{ data: [{ id: "meta-campaign-1" }], error: null }],
    ad_sets: [
      { data: [{ id: "adset-1" }], error: null }, // select
      { data: [{ id: "adset-1" }], error: null }, // update re-point
    ],
    ads: [{ data: [{ id: "ad-1" }], error: null }],
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

  it("replaces local references, returns affected counts, and hides the old image", async () => {
    const { supabase, calls } = createSupabaseMock(happyPathPlan());
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    const result = await replaceMediaAssetEverywhere({ oldAssetId, newAssetId });

    const variantUpdate = calls.find((call) => call.table === "content_variants" && call.method === "update");
    expect(variantUpdate?.args[0]).toEqual({ media_ids: [newAssetId, otherAssetId] });

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
    expect(calls.find((call) => call.table === "ad_sets" && call.method === "update")?.args[0]).toMatchObject({
      adset_media_asset_id: newAssetId,
      adset_image_url: null,
    });
    expect(calls.find((call) => call.table === "ads" && call.method === "update")?.args[0]).toMatchObject({
      media_asset_id: newAssetId,
      preview_url: null,
    });

    const tournamentUpdates = calls.filter((call) => call.table === "tournaments" && call.method === "update");
    expect(tournamentUpdates[0]?.args[0]).toMatchObject({ base_image_square_id: newAssetId });
    expect(tournamentUpdates[1]?.args[0]).toMatchObject({ base_image_story_id: newAssetId });

    const mediaAssetUpdates = calls.filter((call) => call.table === "media_assets" && call.method === "update");
    expect(mediaAssetUpdates.at(-1)?.args[0]).toMatchObject({ hidden_at: expect.any(String) });

    // Return contract: status, per-surface counts, and hide outcome.
    expect(result.status).toBe("replaced");
    expect(result.hidden).toBe(true);
    expect(result.updatedReferences).toBe(9);
    expect(result.remainingReferences).toBe(0);
    expect(result.counts).toMatchObject({
      variants: 1,
      attachments: 1,
      attachmentsDeduped: 0,
      campaigns: 1,
      linkInBioProfiles: 1,
      linkInBioTiles: 1,
      tournamentsSquare: 1,
      tournamentsStory: 1,
      adSets: 1,
      ads: 1,
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/library");
    expect(revalidatePathMock).toHaveBeenCalledWith("/planner");
  });

  it("de-dupes instead of throwing when a post already has both the old and new attachment", async () => {
    const plan = happyPathPlan();
    // item-1 already has the new asset attached; item-2 only has the old one.
    plan.content_media_attachments = [
      {
        data: [
          { id: "attachment-old-item-1", content_item_id: "item-1" },
          { id: "attachment-old-item-2", content_item_id: "item-2" },
        ],
        error: null,
      },
      { data: [{ content_item_id: "item-1" }], error: null }, // item-1 collides
      { error: null }, // delete colliding old row
      { data: [{ id: "attachment-old-item-2" }], error: null }, // update non-colliding
      { data: [], error: null }, // gate: remaining references
    ];
    const { supabase, calls } = createSupabaseMock(plan);
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    const result = await replaceMediaAssetEverywhere({ oldAssetId, newAssetId });

    const attachmentDelete = calls.find(
      (call) => call.table === "content_media_attachments" && call.method === "delete",
    );
    expect(attachmentDelete).toBeTruthy();
    // The delete targets the colliding old row by id (there are several `in`
    // calls on this table, so match on the id filter specifically).
    const deleteIn = calls.find(
      (call) =>
        call.table === "content_media_attachments" &&
        call.method === "in" &&
        call.args[0] === "id" &&
        Array.isArray(call.args[1]) &&
        (call.args[1] as string[]).includes("attachment-old-item-1"),
    );
    expect(deleteIn?.args[1]).toEqual(["attachment-old-item-1"]);

    const attachmentUpdate = calls.find(
      (call) => call.table === "content_media_attachments" && call.method === "update",
    );
    expect(attachmentUpdate?.args[0]).toEqual({ media_id: newAssetId });

    expect(result.counts.attachments).toBe(1);
    expect(result.counts.attachmentsDeduped).toBe(1);
    expect(result.hidden).toBe(true);
  });

  it("does not hide the old asset when planned-post references still remain", async () => {
    const plan = happyPathPlan();
    // A variant still references the old asset at the verification gate.
    plan.content_variants = [
      { data: [{ id: "variant-1", media_ids: [oldAssetId, otherAssetId] }], error: null }, // select
      { error: null }, // update
      { data: [{ id: "variant-stale" }], error: null }, // gate: one still references old
    ];
    const { supabase, calls } = createSupabaseMock(plan);
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    const result = await replaceMediaAssetEverywhere({ oldAssetId, newAssetId });

    const mediaAssetUpdates = calls.filter((call) => call.table === "media_assets" && call.method === "update");
    expect(mediaAssetUpdates).toHaveLength(0); // never hidden
    expect(result.hidden).toBe(false);
    expect(result.remainingReferences).toBeGreaterThan(0);
    expect(result.status).toBe("replaced_with_remaining_references");
  });

  it("does not hide the old asset when no exact references were updated", async () => {
    const { supabase, calls } = createSupabaseMock({
      media_assets: [assetSelectResult],
      media_library: [{ error: null }],
      content_variants: [
        { data: [], error: null }, // no variants to update
        { data: [], error: null }, // gate: no remaining refs
      ],
      content_media_attachments: [
        { data: [], error: null }, // no attachments to update
        { data: [], error: null }, // gate: no remaining refs
      ],
      campaigns: [{ data: [], error: null }],
      link_in_bio_profiles: [{ data: [], error: null }],
      link_in_bio_tiles: [{ data: [], error: null }],
      tournaments: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      meta_campaigns: [{ data: [], error: null }],
    });
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    const result = await replaceMediaAssetEverywhere({ oldAssetId, newAssetId });

    const mediaAssetUpdates = calls.filter((call) => call.table === "media_assets" && call.method === "update");
    expect(mediaAssetUpdates).toHaveLength(0);
    expect(result.hidden).toBe(false);
    expect(result.updatedReferences).toBe(0);
    expect(result.remainingReferences).toBe(0);
    expect(result.status).toBe("replacement_has_no_references");
  });

  it("rejects an original asset outside the account", async () => {
    const { supabase } = createSupabaseMock({
      media_assets: [{ data: [imageAsset({ id: newAssetId })], error: null }],
    });
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Original media was not found for this account.",
    );
  });

  it("rejects a replacement asset outside the account", async () => {
    const { supabase } = createSupabaseMock({
      media_assets: [{ data: [imageAsset({ id: oldAssetId })], error: null }],
    });
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Replacement media was not found for this account.",
    );
  });

  it("rejects video replacement assets", async () => {
    const { supabase } = createSupabaseMock({
      media_assets: [
        {
          data: [imageAsset({ id: oldAssetId }), imageAsset({ id: newAssetId, media_type: "video" })],
          error: null,
        },
      ],
    });
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Only image assets can be replaced with this flow.",
    );
  });

  it("rejects replacement images that are not ready", async () => {
    const { supabase } = createSupabaseMock({
      media_assets: [
        {
          data: [imageAsset({ id: oldAssetId }), imageAsset({ id: newAssetId, processed_status: "processing" })],
          error: null,
        },
      ],
    });
    createServiceSupabaseClientMock.mockReturnValue(supabase);

    const { replaceMediaAssetEverywhere } = await import("@/app/(app)/library/actions");
    await expect(replaceMediaAssetEverywhere({ oldAssetId, newAssetId })).rejects.toThrow(
      "Replacement image is still processing. Try again once ready.",
    );
  });
});
