import { describe, expect, it } from "vitest";

import { postProcessGeneratedCopy } from "@/lib/ai/postprocess";
import type { InstantPostInput } from "@/lib/create/schema";

const baseInput: InstantPostInput = {
  title: "Manager's Special",
  prompt: "Enjoy our offer",
  publishMode: "schedule",
  scheduledFor: new Date("2025-11-09T07:00:00Z"),
  platforms: ["facebook"],
  media: [],
  ctaUrl: "https://example.com/book",
  linkInBioUrl: undefined,
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: false,
  includeEmojis: false,
  ctaStyle: "default",
  placement: "feed",
};

describe("postProcessGeneratedCopy", () => {
  it("replaces countdown hype when the promotion still has ample time remaining", () => {
    const scheduledFor = new Date("2025-11-09T07:00:00Z");
    const context = { promotionEnd: "2025-11-30T22:00:00Z" } as const;

    const result = postProcessGeneratedCopy({
      body: "There's just a week left to cosy up with our special. Don't miss out!",
      platform: "facebook",
      input: baseInput,
      scheduledFor,
      context,
    });

    expect(result.toLowerCase()).not.toContain("week left");
    expect(result).toContain("It runs until Sunday 30 November");
  });

  it("normalises uppercase AM/PM markers", () => {
    const result = postProcessGeneratedCopy({
      body: "Doors open at 7:00 PM and the fun starts at 8 AM.",
      platform: "facebook",
      input: baseInput,
      scheduledFor: baseInput.scheduledFor,
    });

    expect(result).toContain("7pm");
    expect(result).toContain("8am");
    expect(result).not.toContain("PM");
  });

  it("removes banned topics from output", () => {
    const result = postProcessGeneratedCopy({
      body: "Join us for happy hour gin specials and a relaxed evening.",
      platform: "facebook",
      input: baseInput,
      bannedTopics: ["gin"],
    });

    expect(result.toLowerCase()).not.toContain("gin");
    expect(result).toContain("happy hour");
  });
});
