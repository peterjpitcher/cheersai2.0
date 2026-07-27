import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNot = vi.fn();
const mockEq = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockReturns = vi.fn();
const mockSelect = vi.fn();

function buildQueryChain() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    is: mockIs,
    not: mockNot,
    order: mockOrder,
    limit: mockLimit,
    returns: mockReturns,
  };

  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockIs.mockReturnValue(chain);
  mockNot.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockLimit.mockReturnValue(chain);
  mockReturns.mockResolvedValue({ data: [], error: null });

  return chain;
}

const mockFrom = vi.fn();
const mockCreateSignedUrls = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({
    supabase: {
      from: (...args: unknown[]) => mockFrom(...args),
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUrls: (...args: unknown[]) => mockCreateSignedUrls(...args),
        }),
      },
    },
    accountId: "test-account-id",
  }),
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/constants", () => ({
  MEDIA_BUCKET: "media",
}));

vi.mock("@/lib/library/tags", () => ({
  normaliseTags: vi.fn((tags: string[] | null) => tags ?? []),
}));

describe("listMediaAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = buildQueryChain();
    mockFrom.mockReturnValue(chain);
    mockCreateSignedUrls.mockResolvedValue({ data: [], error: null });
  });

  it("applies both tag and path filters when excludeTags includes Tournament", async () => {
    const { listMediaAssets } = await import("./data");

    await listMediaAssets({ excludeTags: ["Tournament"] });

    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{Tournament}");
    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{link-in-bio}");
    expect(mockNot).toHaveBeenCalledWith("storage_path", "like", "tournaments/%");
    expect(mockNot).toHaveBeenCalledTimes(3);
  });

  it("applies only tag filter when excludeTags does not include Tournament", async () => {
    const { listMediaAssets } = await import("./data");

    await listMediaAssets({ excludeTags: ["SomeOtherTag"] });

    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{SomeOtherTag}");
    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{link-in-bio}");
    expect(mockNot).not.toHaveBeenCalledWith(
      "storage_path",
      "like",
      "tournaments/%",
    );
    expect(mockNot).toHaveBeenCalledTimes(2);
  });

  it("excludes system assets when excludeTags is empty", async () => {
    const { listMediaAssets } = await import("./data");

    await listMediaAssets({});

    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{link-in-bio}");
    expect(mockNot).toHaveBeenCalledTimes(1);
  });

  it("excludes system assets when called with no options", async () => {
    const { listMediaAssets } = await import("./data");

    await listMediaAssets();

    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{link-in-bio}");
    expect(mockNot).toHaveBeenCalledTimes(1);
  });

  it("can include system assets for settings previews", async () => {
    const { listMediaAssets } = await import("./data");

    await listMediaAssets({ includeSystemAssets: true });

    expect(mockNot).not.toHaveBeenCalled();
  });

  it("applies path filter alongside multiple tag filters when Tournament is among them", async () => {
    const { listMediaAssets } = await import("./data");

    await listMediaAssets({ excludeTags: ["Draft", "Tournament", "Archive"] });

    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{Draft}");
    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{Tournament}");
    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{Archive}");
    expect(mockNot).toHaveBeenCalledWith("tags", "cs", "{link-in-bio}");
    expect(mockNot).toHaveBeenCalledWith("storage_path", "like", "tournaments/%");
    expect(mockNot).toHaveBeenCalledTimes(5);
  });
});

/**
 * storyPreviewUrl must mean exactly one thing: "a 1080x1920 derivative exists
 * and here it is". The publish worker requires derived_variants.story, so a
 * merely portrait-shaped original is not a story crop, and previewing one would
 * promise the wizard an overlay the worker will reject.
 */
describe("listMediaAssets storyPreviewUrl", () => {
  interface StubAssetRow {
    id: string;
    file_name: string;
    media_type: "image" | "video";
    tags: string[];
    uploaded_at: string;
    size_bytes: number;
    storage_path: string;
    processed_status: "ready";
    processed_at: string;
    derived_variants: Record<string, string>;
    aspect_class: "square" | "story" | "landscape";
  }

  function assetRow(overrides: Partial<StubAssetRow> = {}): StubAssetRow {
    return {
      id: "asset-1",
      file_name: "shot.jpg",
      media_type: "image",
      tags: [],
      uploaded_at: "2026-06-01T00:00:00.000Z",
      size_bytes: 1024,
      storage_path: "account-1/asset-1/shot.jpg",
      processed_status: "ready",
      processed_at: "2026-06-01T00:00:00.000Z",
      derived_variants: { original: "account-1/asset-1/shot.jpg" },
      aspect_class: "square",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    const chain = buildQueryChain();
    mockFrom.mockReturnValue(chain);
    // Sign every requested path, so each assertion is about which path the
    // resolver picked rather than about a signing failure.
    mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}`, error: null })),
      error: null,
    }));
  });

  it("gives a portrait original with no story derivative no story preview", async () => {
    const { listMediaAssets } = await import("./data");
    mockReturns.mockResolvedValue({
      data: [assetRow({ aspect_class: "story" })],
      error: null,
    });

    const [asset] = await listMediaAssets();

    expect(asset.previewUrl).toBe("https://signed.test/account-1/asset-1/shot.jpg");
    expect(asset.storyPreviewUrl).toBeUndefined();
  });

  it("gives a story-named original with no story derivative no story preview", async () => {
    const { listMediaAssets } = await import("./data");
    mockReturns.mockResolvedValue({
      data: [
        assetRow({
          storage_path: "account-1/asset-1/portrait-9x16.jpg",
          derived_variants: {},
        }),
      ],
      error: null,
    });

    const [asset] = await listMediaAssets();

    expect(asset.storyPreviewUrl).toBeUndefined();
  });

  it("points the story preview at the story derivative when one exists", async () => {
    const { listMediaAssets } = await import("./data");
    mockReturns.mockResolvedValue({
      data: [
        assetRow({
          aspect_class: "story",
          derived_variants: {
            original: "account-1/asset-1/shot.jpg",
            story: "derived/asset-1/story.jpg",
          },
        }),
      ],
      error: null,
    });

    const [asset] = await listMediaAssets();

    expect(asset.storyPreviewUrl).toBe("https://signed.test/derived/asset-1/story.jpg");
  });

  it("resolves a bucket-prefixed story derivative path", async () => {
    const { listMediaAssets } = await import("./data");
    mockReturns.mockResolvedValue({
      data: [
        assetRow({
          derived_variants: {
            original: "account-1/asset-1/shot.jpg",
            story: "media/derived/asset-1/story.jpg",
          },
        }),
      ],
      error: null,
    });

    const [asset] = await listMediaAssets();

    expect(asset.storyPreviewUrl).toBe("https://signed.test/derived/asset-1/story.jpg");
  });
});

describe("orderPreviewCandidatesForPlacement", () => {
  it("puts the story-shaped candidate first for story placement", async () => {
    const { orderPreviewCandidatesForPlacement } = await import("./data");

    const candidates = [
      { path: "orig/a.jpg", shape: "square" as const },
      { path: "derived/a/story.jpg", shape: "story" as const },
    ];
    const ordered = orderPreviewCandidatesForPlacement({
      candidates,
      storagePath: "orig/a.jpg",
      placement: "story",
    });

    expect(ordered[0].path).toBe("derived/a/story.jpg");
  });

  it("has no story candidate when the asset has no story derivative", async () => {
    const { orderPreviewCandidatesForPlacement } = await import("./data");

    const candidates = [{ path: "orig/a.jpg", shape: "square" as const }];
    const ordered = orderPreviewCandidatesForPlacement({
      candidates,
      storagePath: "orig/a.jpg",
      placement: "story",
    });

    expect(ordered.find((candidate) => candidate.shape === "story")).toBeUndefined();
  });
});
