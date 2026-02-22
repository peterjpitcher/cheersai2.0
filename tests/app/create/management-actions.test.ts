import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
const getManagementConnectionConfigMock = vi.fn();
const listManagementEventsMock = vi.fn();
const getManagementEventDetailMock = vi.fn();
const listManagementMenuSpecialsMock = vi.fn();
const mapManagementEventToPrefillMock = vi.fn();
const mapManagementSpecialToPrefillMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/create/service", () => ({
  createEventCampaign: vi.fn(),
  createInstantPost: vi.fn(),
  createPromotionCampaign: vi.fn(),
  createStorySeries: vi.fn(),
  createWeeklyCampaign: vi.fn(),
}));

vi.mock("@/lib/planner/data", () => ({
  getPlannerContentDetail: vi.fn(),
}));

vi.mock("@/lib/create/event-cadence", () => ({
  buildEventScheduleOffsets: vi.fn(() => []),
}));

vi.mock("@/lib/management-app/data", () => ({
  getManagementConnectionConfig: (...args: unknown[]) => getManagementConnectionConfigMock(...args),
}));

vi.mock("@/lib/management-app/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/management-app/client")>(
    "@/lib/management-app/client",
  );

  return {
    ...actual,
    listManagementEvents: (...args: unknown[]) => listManagementEventsMock(...args),
    getManagementEventDetail: (...args: unknown[]) => getManagementEventDetailMock(...args),
    listManagementMenuSpecials: (...args: unknown[]) => listManagementMenuSpecialsMock(...args),
  };
});

vi.mock("@/lib/management-app/mappers", () => ({
  mapManagementEventToEventCampaignPrefill: (...args: unknown[]) => mapManagementEventToPrefillMock(...args),
  mapManagementSpecialToPromotionPrefill: (...args: unknown[]) => mapManagementSpecialToPrefillMock(...args),
}));

describe("create actions: management imports", () => {
  beforeEach(() => {
    vi.resetModules();
    revalidatePathMock.mockReset();
    getManagementConnectionConfigMock.mockReset();
    listManagementEventsMock.mockReset();
    getManagementEventDetailMock.mockReset();
    listManagementMenuSpecialsMock.mockReset();
    mapManagementEventToPrefillMock.mockReset();
    mapManagementSpecialToPrefillMock.mockReset();
  });

  it("returns NOT_CONFIGURED when connection settings are missing", async () => {
    getManagementConnectionConfigMock.mockRejectedValue(
      new Error("Management app connection is not configured."),
    );

    const { listManagementEventOptions } = await import("@/app/(app)/create/actions");
    const result = await listManagementEventOptions();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing-connection failure");
    }
    expect(result.error.code).toBe("NOT_CONFIGURED");
  });

  it("returns NOT_CONFIGURED with migration guidance when schema is missing", async () => {
    getManagementConnectionConfigMock.mockRejectedValue({
      code: "PGRST205",
      message: "Could not find the table",
    });

    const { listManagementEventOptions } = await import("@/app/(app)/create/actions");
    const result = await listManagementEventOptions();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected schema-missing failure");
    }
    expect(result.error.code).toBe("NOT_CONFIGURED");
    expect(result.error.message).toContain("latest Supabase migrations");
  });

  it("surfaces UNAUTHORIZED when management API rejects the key", async () => {
    const { ManagementApiError } = await import("@/lib/management-app/client");

    getManagementConnectionConfigMock.mockResolvedValue({
      baseUrl: "https://management.example.com",
      apiKey: "bad-key",
      enabled: true,
    });
    listManagementMenuSpecialsMock.mockRejectedValue(
      new ManagementApiError("UNAUTHORIZED", "Management API rejected credentials.", 401),
    );

    const { listManagementPromotionOptions } = await import("@/app/(app)/create/actions");
    const result = await listManagementPromotionOptions();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unauthorized failure");
    }
    expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("passes event search text into management event listing", async () => {
    getManagementConnectionConfigMock.mockResolvedValue({
      baseUrl: "https://management.example.com",
      apiKey: "valid-key",
      enabled: true,
    });
    listManagementEventsMock.mockResolvedValue([]);

    const { listManagementEventOptions } = await import("@/app/(app)/create/actions");
    const result = await listManagementEventOptions({ query: "quiz", limit: 25 });

    expect(listManagementEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://management.example.com",
      }),
      {
        limit: 25,
        query: "quiz",
      },
    );
    expect(result).toEqual({
      ok: true,
      data: [],
    });
  });

  it("returns mapped prefill payload from selected event", async () => {
    getManagementConnectionConfigMock.mockResolvedValue({
      baseUrl: "https://management.example.com",
      apiKey: "valid-key",
      enabled: true,
    });
    getManagementEventDetailMock.mockResolvedValue({ id: "evt-9", name: "Trivia Thursday" });
    mapManagementEventToPrefillMock.mockReturnValue({
      fields: {
        name: "Trivia Thursday",
        description: "Teams of up to 6. £50 bar tab prize.",
        startDate: "2026-04-17",
        startTime: "19:30",
      },
      sourceLabel: "Trivia Thursday (2026-04-17 19:30)",
    });

    const { getManagementEventPrefill } = await import("@/app/(app)/create/actions");
    const result = await getManagementEventPrefill({ eventId: "evt-9" });

    expect(getManagementEventDetailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://management.example.com",
      }),
      "evt-9",
      {
        fallbackSlug: undefined,
      },
    );
    expect(result).toEqual({
      ok: true,
      data: {
        fields: {
          name: "Trivia Thursday",
          description: "Teams of up to 6. £50 bar tab prize.",
          startDate: "2026-04-17",
          startTime: "19:30",
        },
        sourceLabel: "Trivia Thursday (2026-04-17 19:30)",
      },
    });
  });

  it("passes event slug to prefill lookup when provided", async () => {
    getManagementConnectionConfigMock.mockResolvedValue({
      baseUrl: "https://management.example.com",
      apiKey: "valid-key",
      enabled: true,
    });
    getManagementEventDetailMock.mockResolvedValue({ id: "evt-9", name: "Trivia Thursday" });
    mapManagementEventToPrefillMock.mockReturnValue({
      fields: {
        name: "Trivia Thursday",
      },
      sourceLabel: "Trivia Thursday",
    });

    const { getManagementEventPrefill } = await import("@/app/(app)/create/actions");
    await getManagementEventPrefill({ eventId: "evt-9", eventSlug: "trivia-thursday" });

    expect(getManagementEventDetailMock).toHaveBeenCalledWith(
      expect.any(Object),
      "evt-9",
      {
        fallbackSlug: "trivia-thursday",
      },
    );
  });

  it("returns failure when event detail endpoint returns 404", async () => {
    const { ManagementApiError } = await import("@/lib/management-app/client");

    getManagementConnectionConfigMock.mockResolvedValue({
      baseUrl: "https://management.example.com",
      apiKey: "valid-key",
      enabled: true,
    });
    getManagementEventDetailMock.mockRejectedValue(
      new ManagementApiError("HTTP_ERROR", "Management API request failed (404).", 404),
    );

    const { getManagementEventPrefill } = await import("@/app/(app)/create/actions");
    const result = await getManagementEventPrefill({
      eventId: "evt-404",
      eventSlug: "karaoke-2026-02-27",
    });

    expect(listManagementEventsMock).not.toHaveBeenCalled();
    expect(mapManagementEventToPrefillMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected 404 detail failure");
    }
    expect(result.error.code).toBe("FAILED");
    expect(result.error.message).toContain("returned 404");
  });

  it("returns actionable failure when event detail endpoint returns 500", async () => {
    const { ManagementApiError } = await import("@/lib/management-app/client");

    getManagementConnectionConfigMock.mockResolvedValue({
      baseUrl: "https://management.example.com",
      apiKey: "valid-key",
      enabled: true,
    });
    getManagementEventDetailMock.mockRejectedValue(
      new ManagementApiError(
        "HTTP_ERROR",
        "Management API request failed (500): Failed to load event message templates.",
        500,
      ),
    );

    const { getManagementEventPrefill } = await import("@/app/(app)/create/actions");
    const result = await getManagementEventPrefill({
      eventId: "evt-500",
      eventSlug: "karaoke-2026-02-27",
    });

    expect(listManagementEventsMock).not.toHaveBeenCalled();
    expect(mapManagementEventToPrefillMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected 500 detail failure");
    }
    expect(result.error.code).toBe("FAILED");
    expect(result.error.message).toContain("management API failed");
    expect(result.error.message).toContain("Deploy the latest management API updates");
  });
});
