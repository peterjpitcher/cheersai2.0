// The orchestrator. The two things worth proving here are that a partial kit
// still yields a publishable asset, and that a failure leaves nothing behind:
// no half-written asset the wizard could select, and no storage objects nothing
// points at.

import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const getManagementEventArtwork = vi.fn();
const fetchArtworkFile = vi.fn();
const loadMediaAssetSummary = vi.fn();

vi.mock("@/lib/management-app/client", () => ({
  getManagementEventArtwork: (...args: unknown[]) => getManagementEventArtwork(...args),
}));

vi.mock("@/lib/management-app/artwork-fetch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/management-app/artwork-fetch")>(
    "@/lib/management-app/artwork-fetch",
  );
  return {
    ...actual,
    fetchArtworkFile: (...args: unknown[]) => fetchArtworkFile(...args),
  };
});

vi.mock("@/lib/library/summary", () => ({
  loadMediaAssetSummary: (...args: unknown[]) => loadMediaAssetSummary(...args),
}));

vi.mock("@/env", () => ({
  env: { server: { MANAGEMENT_ARTWORK_ORIGINS: "https://cdn.example.com" }, client: {} },
}));

import { ArtworkFetchError } from "@/lib/management-app/artwork-fetch";
import { importEventArtwork, buildSourceKey, isMixedKit, slugifyEventName } from "@/lib/management-app/artwork-import";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";
const EVENT = "22222222-2222-2222-2222-222222222222";

const URLS = {
  square: "https://cdn.example.com/square.png",
  story: "https://cdn.example.com/story.png",
  landscape: "https://cdn.example.com/landscape.png",
};

function file(url: string, updatedAt = "2026-08-24T10:00:00.000Z", inherited = false) {
  return { url, mimeType: "image/png", sizeBytes: 100, updatedAt, inherited };
}

async function pngBytes(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#204080" } }).png().toBuffer(),
  );
}

// --- A fake Supabase surface, recording what the importer did ---------------

interface FakeState {
  rpc: Record<string, unknown>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  existingAsset: Record<string, unknown> | null;
  uploaded: string[];
  removed: string[][];
  uploadFailsOn: string | null;
  signedOk: boolean;
  updates: Array<Record<string, unknown>>;
}

function makeSupabase(state: FakeState) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      const configured = state.rpc[name];
      if (configured instanceof Error) return { data: null, error: { message: configured.message } };
      return { data: configured ?? null, error: null };
    }),
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.existingAsset, error: null }),
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        state.updates.push({ table, ...values });
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    })),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (state.uploadFailsOn && path.includes(state.uploadFailsOn)) {
            return { error: { message: "upload rejected" } };
          }
          state.uploaded.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          return { error: null };
        },
        createSignedUrls: async (paths: string[]) => ({
          data: state.signedOk
            ? paths.map((path) => ({ path, signedUrl: `signed:${path}`, error: null }))
            : paths.map((path) => ({ path, signedUrl: null, error: "missing" })),
          error: null,
        }),
      }),
    },
  } as never;
}

function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    rpc: { reserve_imported_media_asset: [{ asset_id: null, outcome: "reserved" }] },
    rpcCalls: [],
    existingAsset: null,
    uploaded: [],
    removed: [],
    uploadFailsOn: null,
    signedOk: true,
    updates: [],
    ...overrides,
  };
}

async function runImport(state: FakeState) {
  return importEventArtwork({
    supabase: makeSupabase(state),
    config: { baseUrl: "https://management.example.com", apiKey: "k" },
    accountId: ACCOUNT,
    eventId: EVENT,
    eventName: "Big Sing Friday: Karaoke Night",
    deadlineAt: Date.now() + 60_000,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  loadMediaAssetSummary.mockResolvedValue({ id: "asset", fileName: "a.jpg" });

  const square = await pngBytes(1080, 1080);
  const story = await pngBytes(1080, 1920);
  const landscape = await pngBytes(1920, 1080);

  fetchArtworkFile.mockImplementation(async (url: string) => {
    if (url === URLS.square) return { bytes: square, contentType: "image/png" };
    if (url === URLS.story) return { bytes: story, contentType: "image/png" };
    if (url === URLS.landscape) return { bytes: landscape, contentType: "image/png" };
    throw new ArtworkFetchError("network", "unknown url");
  });
});

describe("importEventArtwork: capability and empty results", () => {
  it("reports an unavailable connection rather than an empty event", async () => {
    // A missing scope and an event with no artwork both produce nothing. Told
    // apart here, because one is normal and the other is a provisioning fault
    // nobody would otherwise notice.
    getManagementEventArtwork.mockResolvedValue({ status: "unavailable", reason: "forbidden" });

    const result = await runImport(freshState());

    expect(result.status).toBe("unavailable");
    expect(result.errorClass).toBe("unavailable_forbidden");
  });

  it("distinguishes an old management app from a missing scope in the logs", async () => {
    getManagementEventArtwork.mockResolvedValue({ status: "unavailable", reason: "unsupported" });
    const result = await runImport(freshState());
    expect(result.errorClass).toBe("unavailable_route");
  });

  it("returns none, and touches nothing, when the event genuinely has no artwork", async () => {
    getManagementEventArtwork.mockResolvedValue({
      status: "ok",
      eventId: EVENT,
      slug: null,
      kitUpdatedAt: null,
      variants: { square: null, story: null, landscape: null },
    });

    const state = freshState();
    const result = await runImport(state);

    expect(result.status).toBe("none");
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.uploaded).toHaveLength(0);
  });
});

describe("importEventArtwork: source-to-output matrix", () => {
  function withVariants(variants: Record<string, unknown>) {
    getManagementEventArtwork.mockResolvedValue({
      status: "ok",
      eventId: EVENT,
      slug: "karaoke",
      kitUpdatedAt: "2026-08-24T10:00:00.000Z",
      variants: { square: null, story: null, landscape: null, ...variants },
    });
  }

  it("uses the designed story for the story crop when it exists", async () => {
    withVariants({ square: file(URLS.square), story: file(URLS.story) });

    const state = freshState();
    const result = await runImport(state);

    expect(result.status).toBe("imported");
    expect(result.warning).toBeUndefined();

    const finalise = state.rpcCalls.find((call) => call.name === "finalise_imported_media_asset");
    expect(finalise?.args.p_derived_variants).toMatchObject({ story: expect.stringContaining("story.jpg") });
    // All four objects, so the asset publishes to both placements.
    expect(state.uploaded).toHaveLength(4);
  });

  it("crops a story from the square when no story artwork exists, and says so", async () => {
    withVariants({ square: file(URLS.square) });

    const result = await runImport(freshState());

    expect(result.status).toBe("imported");
    expect(result.warning).toContain("No designed story artwork");
    expect(result.warning).toContain("square");
  });

  it("crops the feed image from the story when only a story exists", async () => {
    withVariants({ story: file(URLS.story) });

    const result = await runImport(freshState());

    expect(result.status).toBe("imported");
    expect(result.warning).toContain("No square artwork");
  });

  it("still produces a full asset from a landscape alone", async () => {
    withVariants({ landscape: file(URLS.landscape) });

    const state = freshState();
    const result = await runImport(state);

    expect(result.status).toBe("imported");
    expect(state.uploaded).toHaveLength(4);
  });

  it("falls back and reports partial when the story is offered but unreadable", async () => {
    withVariants({ square: file(URLS.square), story: file(URLS.story) });
    fetchArtworkFile.mockImplementation(async (url: string) => {
      if (url === URLS.story) throw new ArtworkFetchError("http_error", "410");
      return { bytes: await pngBytes(1080, 1080), contentType: "image/png" };
    });

    const result = await runImport(freshState());

    // The wording has to differ from the no-artwork case: one is a management
    // app the user should fix, the other is normal.
    expect(result.status).toBe("partial");
    expect(result.warning).toContain("could not be read");
    expect(result.sourceCounts).toMatchObject({ offered: 2, fetched: 1, failed: 1 });
  });

  it("fails cleanly when every source is unreadable", async () => {
    withVariants({ square: file(URLS.square), story: file(URLS.story) });
    fetchArtworkFile.mockRejectedValue(new ArtworkFetchError("timeout", "slow"));

    const state = freshState();
    const result = await runImport(state);

    expect(result.status).toBe("failed");
    expect(state.uploaded).toHaveLength(0);
    // The reservation must be given back, or that source key is dead forever.
    expect(state.rpcCalls.map((call) => call.name)).toContain("release_imported_media_asset");
  });

  it("flags a square inherited from the category rather than designed", async () => {
    withVariants({ square: file(URLS.square, "2026-08-24T10:00:00.000Z", true) });
    const result = await runImport(freshState());
    expect(result.warning).toContain("category's default image");
  });

  it("warns when the source kit looks part-updated", async () => {
    withVariants({
      square: file(URLS.square, "2026-08-24T10:00:00.000Z"),
      story: file(URLS.story, "2026-08-24T14:00:00.000Z"),
    });

    const result = await runImport(freshState());
    expect(result.warning).toContain("part-updated");
  });
});

describe("importEventArtwork: concurrency and cleanup", () => {
  beforeEach(() => {
    getManagementEventArtwork.mockResolvedValue({
      status: "ok",
      eventId: EVENT,
      slug: "karaoke",
      kitUpdatedAt: null,
      variants: { square: file(URLS.square), story: file(URLS.story), landscape: null },
    });
  });

  it("does no work when another import already owns the same artwork", async () => {
    const state = freshState({
      rpc: { reserve_imported_media_asset: [{ asset_id: "other", outcome: "in_progress" }] },
    });

    const result = await runImport(state);

    expect(result.status).toBe("in_progress");
    expect(state.uploaded).toHaveLength(0);
  });

  it("returns the finished asset when one already exists for this source", async () => {
    const state = freshState({
      rpc: { reserve_imported_media_asset: [{ asset_id: "existing", outcome: "reused" }] },
    });

    const result = await runImport(state);

    expect(result.status).toBe("reused");
    expect(state.uploaded).toHaveLength(0);
  });

  it("removes every object it wrote when a later upload fails", async () => {
    // Storage and Postgres cannot share a transaction, so this compensation is
    // the only thing standing between a failed import and permanent litter.
    const state = freshState({ uploadFailsOn: "landscape.jpg" });

    const result = await runImport(state);

    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("upload_failed");
    expect(state.removed.flat().length).toBe(state.uploaded.length);
    expect(state.removed.flat().length).toBeGreaterThan(0);
    expect(state.rpcCalls.map((call) => call.name)).toContain("release_imported_media_asset");
  });

  it("cleans up when the database write fails after the uploads succeeded", async () => {
    const state = freshState({
      rpc: {
        reserve_imported_media_asset: [{ asset_id: null, outcome: "reserved" }],
        finalise_imported_media_asset: new Error("constraint violated"),
      },
    });

    const result = await runImport(state);

    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("db_failed");
    expect(state.removed.flat()).toHaveLength(4);
  });

  it("gives up rather than writing past its deadline", async () => {
    const state = freshState();

    const result = await importEventArtwork({
      supabase: makeSupabase(state),
      config: { baseUrl: "https://management.example.com", apiKey: "k" },
      accountId: ACCOUNT,
      eventId: EVENT,
      eventName: "Late",
      deadlineAt: Date.now() - 1,
    });

    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("deadline_exceeded");
    expect(state.uploaded).toHaveLength(0);
  });
});

describe("importEventArtwork: reuse validity", () => {
  beforeEach(() => {
    getManagementEventArtwork.mockResolvedValue({
      status: "ok",
      eventId: EVENT,
      slug: "karaoke",
      kitUpdatedAt: null,
      variants: { square: file(URLS.square), story: file(URLS.story), landscape: null },
    });
  });

  const readyAsset = {
    id: "existing-asset",
    processed_status: "ready",
    hidden_at: null,
    storage_path: "acct/existing/a.jpg",
    derived_variants: {
      story: "derived/existing/story.jpg",
      square: "derived/existing/square.jpg",
      landscape: "derived/existing/landscape.jpg",
    },
  };

  it("reuses a healthy previous import without re-downloading anything", async () => {
    const state = freshState({ existingAsset: readyAsset });

    const result = await runImport(state);

    expect(result.status).toBe("reused");
    expect(fetchArtworkFile).not.toHaveBeenCalled();
    expect(state.uploaded).toHaveLength(0);
  });

  it.each([
    ["hidden by the user", { ...readyAsset, hidden_at: "2026-08-01T00:00:00Z" }],
    ["never finished", { ...readyAsset, processed_status: "processing" }],
    ["missing its story derivative", { ...readyAsset, derived_variants: { square: "x", landscape: "y" } }],
  ])("re-imports rather than reusing an asset that is %s", async (_label, asset) => {
    // Provenance proves origin, not that the asset still works. Reusing a broken
    // one hands the user something that looks selected and fails at publish.
    const state = freshState({ existingAsset: asset });

    const result = await runImport(state);

    expect(result.status).toBe("imported");
    expect(state.updates.some((update) => update.source_key === null)).toBe(true);
  });

  it("re-imports when the storage objects have gone missing", async () => {
    const state = freshState({ existingAsset: readyAsset, signedOk: false });

    const result = await runImport(state);

    expect(result.status).toBe("imported");
    // The old row keeps its place in the library, because a scheduled post may
    // still point at it. Only the key is released.
    expect(state.updates.some((update) => update.source_key === null)).toBe(true);
  });
});

describe("source key", () => {
  it("is stable for identical inputs", () => {
    const variants = { square: file(URLS.square), story: file(URLS.story), landscape: null };
    expect(buildSourceKey(EVENT, variants)).toBe(buildSourceKey(EVENT, variants));
  });

  it("changes when the source artwork is replaced", () => {
    // Otherwise a re-import silently serves the old render, and the user's new
    // artwork never reaches a post.
    const before = buildSourceKey(EVENT, { square: file(URLS.square, "2026-01-01T00:00:00.000Z"), story: null, landscape: null });
    const after = buildSourceKey(EVENT, { square: file(URLS.square, "2026-06-01T00:00:00.000Z"), story: null, landscape: null });
    expect(before).not.toBe(after);
  });

  it("distinguishes a removed variant from an unchanged one", () => {
    const withLandscape = buildSourceKey(EVENT, { square: file(URLS.square), story: null, landscape: file(URLS.landscape) });
    const without = buildSourceKey(EVENT, { square: file(URLS.square), story: null, landscape: null });
    expect(withLandscape).not.toBe(without);
  });

  it("is namespaced by event so two events never collide", () => {
    const a = buildSourceKey(EVENT, { square: file(URLS.square), story: null, landscape: null });
    const b = buildSourceKey("33333333-3333-3333-3333-333333333333", { square: file(URLS.square), story: null, landscape: null });
    expect(a).not.toBe(b);
  });
});

describe("isMixedKit", () => {
  it("is quiet when the variants were uploaded in one session", () => {
    expect(
      isMixedKit({
        square: file(URLS.square, "2026-08-24T10:00:00.000Z"),
        story: file(URLS.story, "2026-08-24T10:02:00.000Z"),
        landscape: null,
      }),
    ).toBe(false);
  });

  it("flags variants replaced hours apart", () => {
    expect(
      isMixedKit({
        square: file(URLS.square, "2026-08-24T10:00:00.000Z"),
        story: file(URLS.story, "2026-08-24T16:00:00.000Z"),
        landscape: null,
      }),
    ).toBe(true);
  });

  it("cannot judge a kit with only one dated variant", () => {
    expect(isMixedKit({ square: file(URLS.square), story: null, landscape: null })).toBe(false);
  });
});

describe("slugifyEventName", () => {
  it("makes a recognisable, safe file stem", () => {
    expect(slugifyEventName("Big Sing Friday: Karaoke Night")).toBe("big-sing-friday-karaoke-night");
  });

  it("never returns an empty stem", () => {
    expect(slugifyEventName("!!!")).toBe("event");
    expect(slugifyEventName("   ")).toBe("event");
  });

  it("does not end on a separator after truncation", () => {
    expect(slugifyEventName("a".repeat(40) + " " + "b".repeat(40)).endsWith("-")).toBe(false);
  });
});
