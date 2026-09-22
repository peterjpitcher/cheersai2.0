import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const createServiceSupabaseClientMock = vi.fn();
const generateMediaNameAndTagsMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({ requireAuthContext: requireAuthContextMock }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabaseClient: createServiceSupabaseClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/media-tagging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/media-tagging")>()),
  generateMediaNameAndTags: generateMediaNameAndTagsMock,
}));
vi.mock("@/lib/library/summary", () => ({
  mapToSummary: vi.fn(),
  signStoryPreview: vi.fn(),
  signPreviewFromCandidates: vi.fn(async () => ({ url: "https://storage.example/signed.jpg" })),
}));
vi.mock("@/lib/library/data", () => ({
  resolvePreviewCandidates: vi.fn(() => []),
  normaliseStoragePath: vi.fn((path: string) => path),
}));

const assetRow = {
  id: "asset-1",
  file_name: "photo.jpg",
  media_type: "image",
  storage_path: "brand-1/photo.jpg",
  derived_variants: {},
  aspect_class: "square",
};

function createSupabaseMock(brandRow: { business_type: string | null } | null) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const results: Record<string, unknown> = { media_assets: assetRow, brand_profile: brandRow };

  const supabase = {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        });
      }
      builder.maybeSingle = vi.fn(async () => ({ data: results[table] ?? null, error: null }));
      return builder;
    }),
  };

  return { supabase, calls };
}

describe("autoNameAndTagMediaAsset business type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ accountId: "brand-1" });
    // Same name and no tags: nothing to write, so the action stops after the AI call.
    generateMediaNameAndTagsMock.mockResolvedValue({ name: "photo", tags: [] });
  });

  it("passes the active brand's business type to the tagger", async () => {
    const { supabase, calls } = createSupabaseMock({ business_type: "websites and applications company" });
    createServiceSupabaseClientMock.mockReturnValue(supabase);
    const { autoNameAndTagMediaAsset } = await import("@/app/(app)/library/actions");

    await autoNameAndTagMediaAsset("asset-1");

    expect(generateMediaNameAndTagsMock).toHaveBeenCalledWith({
      imageUrl: "https://storage.example/signed.jpg",
      businessType: "websites and applications company",
    });
    expect(calls).toContainEqual({ table: "brand_profile", method: "eq", args: ["account_id", "brand-1"] });
  });

  it("leaves the business type unset (a pub) when the brand has none", async () => {
    const { supabase } = createSupabaseMock(null);
    createServiceSupabaseClientMock.mockReturnValue(supabase);
    const { autoNameAndTagMediaAsset } = await import("@/app/(app)/library/actions");

    await autoNameAndTagMediaAsset("asset-1");

    expect(generateMediaNameAndTagsMock).toHaveBeenCalledWith({
      imageUrl: "https://storage.example/signed.jpg",
      businessType: undefined,
    });
  });
});
