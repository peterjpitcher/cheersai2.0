import { beforeEach, describe, expect, it, vi } from "vitest";

const getOwnerSettingsMock = vi.fn();

vi.mock("@/lib/library/data", () => ({ listMediaAssets: vi.fn(async () => []) }));
vi.mock("@/lib/planner/data", () => ({ getPlannerOverview: vi.fn(async () => ({ items: [] })) }));
vi.mock("@/lib/settings/data", () => ({
  getOwnerSettings: (...args: unknown[]) => getOwnerSettingsMock(...args),
}));

function settingsWithVenue(defaultEventVenue?: string) {
  return {
    brand: {},
    posting: {
      timezone: "Europe/London",
      defaultEventVenue,
      notifications: { emailFailures: true, emailTokenExpiring: true },
      bannerDefaults: {
        bannersEnabled: true,
        bannerPosition: "right",
        bannerBg: "#a57626",
        bannerTextColour: "#FFFFFF",
      },
    },
  };
}

describe("getCreateModalData default event venue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the active brand's default event venue", async () => {
    getOwnerSettingsMock.mockResolvedValue(settingsWithVenue("The Anchor, Stanwell Moor Village"));
    const { getCreateModalData } = await import("@/features/create/create-modal-actions");

    const data = await getCreateModalData();

    expect(data.defaultEventVenue).toBe("The Anchor, Stanwell Moor Village");
  });

  it("returns an empty venue when the brand has none", async () => {
    getOwnerSettingsMock.mockResolvedValue(settingsWithVenue(undefined));
    const { getCreateModalData } = await import("@/features/create/create-modal-actions");

    const data = await getCreateModalData();

    expect(data.defaultEventVenue).toBe("");
  });
});
