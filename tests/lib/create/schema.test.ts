import { describe, expect, it } from "vitest";
import { weeklyCampaignSchema } from "@/lib/create/schema";

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
