import { describe, expect, it } from "vitest";

import { brandProfileFormSchema, postingDefaultsFormSchema } from "@/features/settings/schema";

const basePostingDefaults = {
  timezone: "Europe/London",
  notifications: {
    emailFailures: true,
    emailTokenExpiring: true,
  },
  bannerDefaults: {
    bannersEnabled: false,
    bannerPosition: "bottom",
    bannerBg: "#000000",
    bannerTextColour: "#ffffff",
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

  it("trims the default event venue and caps it at 200 characters", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      defaultEventVenue: "  The Anchor, Stanwell Moor Village  ",
    });

    expect(parsed.defaultEventVenue).toBe("The Anchor, Stanwell Moor Village");
    expect(
      postingDefaultsFormSchema.safeParse({ ...basePostingDefaults, defaultEventVenue: "v".repeat(200) }).success,
    ).toBe(true);
    expect(
      postingDefaultsFormSchema.safeParse({ ...basePostingDefaults, defaultEventVenue: "v".repeat(201) }).success,
    ).toBe(false);
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

const baseBrandProfile = {
  toneFormal: 0.5,
  tonePlayful: 0.5,
  keyPhrases: [],
  bannedTopics: [],
  bannedPhrases: [],
  defaultHashtags: [],
  defaultEmojis: [],
};

describe("brandProfileFormSchema business fields", () => {
  it("trims the business type and description", () => {
    const parsed = brandProfileFormSchema.parse({
      ...baseBrandProfile,
      businessType: "  websites and applications company  ",
      businessDescription: "  We build websites.  ",
    });

    expect(parsed.businessType).toBe("websites and applications company");
    expect(parsed.businessDescription).toBe("We build websites.");
  });

  it("allows both fields to be blank or missing, which means a pub", () => {
    expect(brandProfileFormSchema.parse({ ...baseBrandProfile, businessType: "   " }).businessType).toBe("");
    expect(brandProfileFormSchema.parse(baseBrandProfile).businessType).toBeUndefined();
  });

  it("enforces the same limits as the database checks", () => {
    expect(brandProfileFormSchema.safeParse({ ...baseBrandProfile, businessType: "a".repeat(60) }).success).toBe(true);
    expect(brandProfileFormSchema.safeParse({ ...baseBrandProfile, businessType: "a".repeat(61) }).success).toBe(false);
    expect(
      brandProfileFormSchema.safeParse({ ...baseBrandProfile, businessDescription: "b".repeat(400) }).success,
    ).toBe(true);
    expect(
      brandProfileFormSchema.safeParse({ ...baseBrandProfile, businessDescription: "b".repeat(401) }).success,
    ).toBe(false);
  });
});
