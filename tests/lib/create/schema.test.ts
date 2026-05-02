import { describe, expect, it } from "vitest";
import {
  promotionCampaignFormSchema,
  promotionCampaignSchema,
  storySeriesFormSchema,
  weeklyCampaignSchema,
} from "@/lib/create/schema";

/**
 * Minimal valid base data for weeklyCampaignSchema.
 * Tests extend or override specific fields as needed.
 */
function validBase(overrides: Record<string, unknown> = {}) {
  return {
    name: "Weekly Quiz Night",
    description: "Pub quiz every Thursday",
    dayOfWeek: 4,
    startDate: new Date("2026-04-16"),
    time: "19:00",
    weeksAhead: 4,
    platforms: ["facebook"],
    heroMedia: [{ assetId: "img-1", mediaType: "image" }],
    ...overrides,
  };
}

describe("weeklyCampaignSchema scheduleMode fields", () => {
  it("accepts spread_evenly with postsPerWeek=3", () => {
    const result = weeklyCampaignSchema.safeParse(
      validBase({ scheduleMode: "spread_evenly", postsPerWeek: 3 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects spread_evenly without postsPerWeek", () => {
    const result = weeklyCampaignSchema.safeParse(
      validBase({ scheduleMode: "spread_evenly" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("postsPerWeek");
    }
  });

  it("accepts fixed_days without postsPerWeek", () => {
    const result = weeklyCampaignSchema.safeParse(
      validBase({ scheduleMode: "fixed_days" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects postsPerWeek=0", () => {
    const result = weeklyCampaignSchema.safeParse(
      validBase({ scheduleMode: "spread_evenly", postsPerWeek: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects postsPerWeek=8", () => {
    const result = weeklyCampaignSchema.safeParse(
      validBase({ scheduleMode: "spread_evenly", postsPerWeek: 8 }),
    );
    expect(result.success).toBe(false);
  });

  it("defaults scheduleMode to fixed_days when omitted", () => {
    const result = weeklyCampaignSchema.safeParse(validBase());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheduleMode).toBe("fixed_days");
    }
  });

  it("defaults staggerPlatforms to true when omitted", () => {
    const result = weeklyCampaignSchema.safeParse(validBase());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.staggerPlatforms).toBe(true);
    }
  });
});

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

  it("accepts internal promotion input with ends_on date mode", () => {
    const result = promotionCampaignSchema.safeParse({
      name: "Manager's Special",
      offerSummary: "25% off Gordon's Tropical Passionfruit.",
      startDate: new Date("2026-05-02T00:00:00.000Z"),
      endDate: new Date("2026-06-10T00:00:00.000Z"),
      dateMode: "ends_on",
      platforms: ["instagram"],
      heroMedia: [{ assetId: "img-1", mediaType: "image" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("storySeriesFormSchema schedule fields", () => {
  const validStorySeries = {
    title: "Weekend stories",
    eventDate: "2026-05-10",
    platforms: ["instagram"],
    slots: [
      {
        date: "2026-05-08",
        time: "07:00",
        media: [{ assetId: "story-1", mediaType: "image" }],
      },
    ],
  };

  it("accepts story slots at 07:00", () => {
    const result = storySeriesFormSchema.safeParse(validStorySeries);
    expect(result.success).toBe(true);
  });

  it("rejects duplicate story dates because stories always use 07:00", () => {
    const result = storySeriesFormSchema.safeParse({
      ...validStorySeries,
      slots: [
        ...validStorySeries.slots,
        {
          date: "2026-05-08",
          time: "12:00",
          media: [{ assetId: "story-2", mediaType: "image" }],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === "Each story needs a unique date.")).toBe(true);
    }
  });
});
