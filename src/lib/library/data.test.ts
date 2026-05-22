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

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({
    supabase: {
      from: (...args: unknown[]) => mockFrom(...args),
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
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
