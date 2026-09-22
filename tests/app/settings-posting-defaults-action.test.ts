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
  timezone: "Europe/London",
  notifications: { emailFailures: true, emailTokenExpiring: true },
  bannerDefaults: {
    bannersEnabled: true,
    bannerPosition: "right",
    bannerBg: "#a57626",
    bannerTextColour: "#FFFFFF",
  },
} as const;

function postingPayloads() {
  return upsertMock.mock.calls.map(([payload]) => payload as Record<string, unknown>);
}

describe("updatePostingDefaults default event venue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ accountId: "brand-1" });
    upsertMock.mockReturnValue({ throwOnError: () => Promise.resolve({ error: null }) });
    const updateChain = { eq: () => ({ throwOnError: () => Promise.resolve({ error: null }) }) };
    fromMock.mockReturnValue({ upsert: upsertMock, update: () => updateChain });
  });

  it("saves the trimmed venue against the active brand", async () => {
    const { updatePostingDefaults } = await import("@/app/(app)/settings/actions");

    await updatePostingDefaults({ ...baseForm, defaultEventVenue: "  Orange Jelly office, Staines " });

    expect(fromMock).toHaveBeenCalledWith("posting_defaults");
    expect(postingPayloads()[0]).toMatchObject({
      account_id: "brand-1",
      default_event_venue: "Orange Jelly office, Staines",
    });
  });

  it("stores a blank or missing venue as null, so events start blank", async () => {
    const { updatePostingDefaults } = await import("@/app/(app)/settings/actions");

    await updatePostingDefaults({ ...baseForm, defaultEventVenue: "   " });
    await updatePostingDefaults(baseForm);

    expect(postingPayloads()).toHaveLength(2);
    for (const payload of postingPayloads()) {
      expect(payload.default_event_venue).toBeNull();
    }
  });
});
