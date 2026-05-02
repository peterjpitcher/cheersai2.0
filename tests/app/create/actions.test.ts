import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

const createStorySeriesMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/create/service", () => ({
  createEventCampaign: vi.fn(),
  createInstantPost: vi.fn(),
  createPromotionCampaign: vi.fn(),
  createStorySeries: (...args: unknown[]) => createStorySeriesMock(...args),
  createWeeklyCampaign: vi.fn(),
}));

vi.mock("@/lib/planner/data", () => ({
  getPlannerContentDetail: vi.fn(),
}));

vi.mock("@/lib/create/event-cadence", () => ({
  buildEventScheduleOffsets: vi.fn(() => []),
}));

vi.mock("@/lib/management-app/data", () => ({
  getManagementConnectionConfig: vi.fn(),
}));

vi.mock("@/lib/management-app/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/management-app/client")>(
    "@/lib/management-app/client",
  );

  return {
    ...actual,
    getManagementEventDetail: vi.fn(),
    listManagementEvents: vi.fn(),
    listManagementMenuSpecials: vi.fn(),
  };
});

vi.mock("@/lib/management-app/mappers", () => ({
  mapManagementEventToEventCampaignPrefill: vi.fn(),
  mapManagementSpecialToPromotionPrefill: vi.fn(),
}));

describe("create actions: story series", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T15:23:00.000Z"));
    createStorySeriesMock.mockReset();
    revalidatePathMock.mockReset();
    createStorySeriesMock.mockResolvedValue({
      status: "draft",
      scheduledFor: null,
      contentItemIds: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps today and tomorrow story slots unique after today's default story time has passed", async () => {
    const { handleStorySeriesSubmission } = await import("@/app/(app)/create/actions");

    await expect(
      handleStorySeriesSubmission({
        title: "Weekend stories",
        eventDate: "2026-05-04",
        platforms: ["instagram"],
        slots: [
          {
            date: "2026-05-02",
            time: "07:00",
            media: [{ assetId: "story-1", mediaType: "image" }],
          },
          {
            date: "2026-05-03",
            time: "07:00",
            media: [{ assetId: "story-2", mediaType: "image" }],
          },
        ],
      }),
    ).resolves.toEqual({
      status: "draft",
      scheduledFor: null,
      contentItemIds: [],
    });

    const input = createStorySeriesMock.mock.calls[0]?.[0] as {
      slots: Array<{ scheduledFor: Date }>;
    };
    const scheduled = input.slots.map((slot) =>
      DateTime.fromJSDate(slot.scheduledFor, { zone: "Europe/London" }).toFormat("yyyy-LL-dd HH:mm"),
    );

    expect(scheduled).toEqual(["2026-05-02 16:38", "2026-05-03 07:00"]);
  });
});
