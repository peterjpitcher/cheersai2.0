import { describe, expect, it } from "vitest";

import { postingDefaultsFormSchema } from "@/features/settings/schema";

const basePostingDefaults = {
  timezone: "Europe/London",
  notifications: {
    emailFailures: true,
    emailTokenExpiring: true,
  },
  gbpCtaDefaults: {
    standard: "LEARN_MORE",
    event: "LEARN_MORE",
    offer: "REDEEM",
  },
} as const;

describe("postingDefaultsFormSchema", () => {
  it("trims a visible venue location for paid ads targeting", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLocation: "  123 High Street, Leatherhead  ",
    });

    expect(parsed.venueLocation).toBe("123 High Street, Leatherhead");
  });

  it("allows the venue location field to be left blank", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLocation: "",
    });

    expect(parsed.venueLocation).toBe("");
  });

  it("accepts valid Meta Ads coordinates", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLatitude: "51.4625",
      venueLongitude: "-0.5021",
    });

    expect(parsed.venueLatitude).toBe("51.4625");
    expect(parsed.venueLongitude).toBe("-0.5021");
  });

  it("requires latitude and longitude to be entered together", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "51.4625",
      venueLongitude: "",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("both latitude and longitude");
  });

  it("rejects out-of-range coordinates", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "151.4625",
      venueLongitude: "-0.5021",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("UK latitude");
  });

  it("rejects likely swapped coordinates", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "-0.5021",
      venueLongitude: "51.4625",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join(" ")).toContain("UK latitude");
  });
});
