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
});
