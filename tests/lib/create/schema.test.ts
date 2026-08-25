import { describe, expect, it } from "vitest";
import {
  eventCampaignFormSchema,
  eventCampaignSchema,
  promotionCampaignFormSchema,
} from "@/lib/create/schema";
import { contentBriefSchema } from "@/features/create/schemas/content-schemas";

function validPromotionForm(overrides: Record<string, unknown> = {}) {
  return {
    name: "Manager's Special",
    offerSummary: "25% off Gordon's Tropical Passionfruit.",
    endDate: "2026-06-10",
    platforms: ["facebook"],
    heroMedia: [{ assetId: "img-1", mediaType: "image" }],
    useManualSchedule: true,
    manualSlots: [{ date: "2026-05-06" }],
    ...overrides,
  };
}

describe("promotionCampaignFormSchema end-date fields", () => {
  it("accepts promotion forms with endDate and no startDate", () => {
    const result = promotionCampaignFormSchema.safeParse(validPromotionForm());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.endDate).toBe("2026-06-10");
      expect("startDate" in result.data).toBe(false);
      expect(result.data.manualSlots).toEqual([{ date: "2026-05-06" }]);
    }
  });

  it("rejects promotion forms without endDate", () => {
    const result = promotionCampaignFormSchema.safeParse(validPromotionForm({ endDate: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("endDate");
    }
  });
});

describe("contentBriefSchema campaign placements", () => {
  it("accepts feed and story together on event briefs", () => {
    // Every day an event is posted about, it also gets a story. The batch
    // builder creates one content item per slot, platform and placement, so the
    // pair has always been buildable; this schema was the thing refusing it.
    const result = contentBriefSchema.safeParse({
      contentType: "event",
      title: "Quiz Night",
      eventName: "Quiz Night",
      eventDate: "2026-06-15",
      eventTime: "19:00",
      platforms: ["facebook", "instagram"],
      placements: ["feed", "story"],
    });

    expect(result.success).toBe(true);
  });

  it("defaults event briefs to feed and story", () => {
    const result = contentBriefSchema.safeParse({
      contentType: "event",
      title: "Quiz Night",
      eventName: "Quiz Night",
      eventDate: "2026-06-15",
      eventTime: "19:00",
      platforms: ["facebook", "instagram"],
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.contentType === "event") {
      expect(result.data.placements).toEqual(["feed", "story"]);
    }
  });

  it("defaults promotion briefs to feed placement", () => {
    const result = contentBriefSchema.safeParse({
      contentType: "promotion",
      title: "Manager's Special",
      offerSummary: "25% off Gordon's Tropical Passionfruit.",
      endDate: "2026-06-10",
      platforms: ["facebook"],
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.contentType === "promotion") {
      expect(result.data.placements).toEqual(["feed"]);
    }
  });

  it("accepts feed and story placements on a promotion brief", () => {
    const result = contentBriefSchema.safeParse({
      contentType: "promotion",
      title: "Manager's Special",
      offerSummary: "25% off Gordon's Tropical Passionfruit.",
      endDate: "2026-06-10",
      platforms: ["facebook", "instagram"],
      placements: ["feed", "story"],
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.contentType === "promotion") {
      expect(result.data.placements).toEqual(["feed", "story"]);
    }
  });
});

describe("event campaign placement schemas", () => {
  it("accepts event campaign form values with feed and story together", () => {
    // Events post to the feed and as a story on the same day. This used to be
    // rejected outright, which is what kept event stories from being created at
    // all, even though the batch builder had always handled the pair.
    const result = eventCampaignFormSchema.safeParse({
      name: "Quiz Night",
      description: "Friendly pub quiz",
      startDate: "2026-06-15",
      startTime: "19:00",
      platforms: ["facebook", "instagram"],
      heroMedia: [{ assetId: "img-1", mediaType: "image" }],
      placements: ["feed", "story"],
    });

    expect(result.success).toBe(true);
  });

  it("still requires at least one placement", () => {
    const result = eventCampaignFormSchema.safeParse({
      name: "Quiz Night",
      description: "Friendly pub quiz",
      startDate: "2026-06-15",
      startTime: "19:00",
      platforms: ["facebook", "instagram"],
      heroMedia: [{ assetId: "img-1", mediaType: "image" }],
      placements: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a story-only event campaign", () => {
    const result = eventCampaignSchema.safeParse({
      name: "Quiz Night",
      description: "Friendly pub quiz",
      startDate: new Date("2026-06-15T00:00:00.000Z"),
      startTime: "19:00",
      platforms: ["facebook", "instagram"],
      heroMedia: [{ assetId: "img-1", mediaType: "image" }],
      placements: ["story"],
      scheduleOffsets: [{ label: "Event day", offsetHours: 0 }],
    });

    expect(result.success).toBe(true);
  });
});
