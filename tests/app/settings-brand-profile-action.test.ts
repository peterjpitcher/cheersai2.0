import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const upsertMock = vi.fn();
const fromMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContextMock(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({ from: fromMock }),
}));
vi.mock("@/lib/link-in-bio/profile", () => ({}));
vi.mock("@/lib/management-app/connection-check", () => ({}));
vi.mock("@/lib/management-app/client", () => ({ ManagementApiError: class extends Error {} }));
vi.mock("@/lib/management-app/data", () => ({}));

const baseForm = {
  toneFormal: 0.5,
  tonePlayful: 0.5,
  keyPhrases: [],
  bannedTopics: [],
  bannedPhrases: [],
  defaultHashtags: [],
  defaultEmojis: [],
};

describe("updateBrandProfile business fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ accountId: "brand-1" });
    upsertMock.mockReturnValue({ throwOnError: () => Promise.resolve({ error: null }) });
    fromMock.mockReturnValue({ upsert: upsertMock });
  });

  it("saves trimmed values against the active brand", async () => {
    const { updateBrandProfile } = await import("@/app/(app)/settings/actions");

    await updateBrandProfile({
      ...baseForm,
      businessType: "  websites and applications company ",
      businessDescription: " We build websites. ",
    });

    expect(fromMock).toHaveBeenCalledWith("brand_profile");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "brand-1",
        business_type: "websites and applications company",
        business_description: "We build websites.",
      }),
      { onConflict: "account_id" },
    );
  });

  it("stores blank or missing values as null so the AI keeps the pub default", async () => {
    const { updateBrandProfile } = await import("@/app/(app)/settings/actions");

    await updateBrandProfile({ ...baseForm, businessType: "   ", businessDescription: "" });
    await updateBrandProfile(baseForm);

    for (const [payload] of upsertMock.mock.calls) {
      expect(payload).toMatchObject({ business_type: null, business_description: null });
    }
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an over-long business type without writing", async () => {
    const { updateBrandProfile } = await import("@/app/(app)/settings/actions");

    await expect(updateBrandProfile({ ...baseForm, businessType: "a".repeat(61) })).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
