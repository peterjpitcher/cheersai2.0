import { describe, expect, it } from "vitest";

import {
  linkInBioProfileFormSchema,
  linkInBioTileFormSchema,
} from "@/features/settings/schema";

describe("link-in-bio profile schema", () => {
  it("accepts minimal valid payload", () => {
    const parsed = linkInBioProfileFormSchema.parse({
      slug: "the-anchor",
      theme: {
        primaryColor: "#005131",
        secondaryColor: "#a57626",
      },
    });

    expect(parsed.slug).toBe("the-anchor");
    expect(parsed.theme.primaryColor).toBe("#005131");
  });

  it("normalises blank optional fields", () => {
    const parsed = linkInBioProfileFormSchema.parse({
      slug: "my-venue",
      displayName: "",
      bio: "",
      heroMediaId: "",
      theme: {},
    });

    expect(parsed.displayName).toBeUndefined();
    expect(parsed.heroMediaId).toBeUndefined();
  });

  it("rejects invalid slug", () => {
    expect(() =>
      linkInBioProfileFormSchema.parse({
        slug: "Bad Slug!",
        theme: {},
      }),
    ).toThrow();
  });
});

describe("link-in-bio tile schema", () => {
  it("requires title and link", () => {
    const parsed = linkInBioTileFormSchema.parse({
      title: "Live music Fridays",
      ctaLabel: "Learn more",
      ctaUrl: "https://example.com",
      enabled: true,
    });

    expect(parsed.title).toBe("Live music Fridays");
    expect(parsed.mediaAssetId).toBeUndefined();
  });

  it("rejects invalid URL", () => {
    expect(() =>
      linkInBioTileFormSchema.parse({
        title: "Bad URL",
        ctaLabel: "Visit",
        ctaUrl: "not-a-url",
      }),
    ).toThrow();
  });
});
