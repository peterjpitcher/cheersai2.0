import { describe, expect, it } from "vitest";

import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import type { InstantPostInput } from "@/lib/create/schema";
import type { BrandProfile } from "@/lib/settings/data";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildBrand(overrides: Partial<BrandProfile> = {}): BrandProfile {
  return {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: ["good food and a warm welcome"],
    bannedTopics: [],
    bannedPhrases: [],
    defaultHashtags: ["#cheers", "#publife"],
    defaultEmojis: ["🍺"],
    instagramSignature: undefined,
    facebookSignature: undefined,
    ...overrides,
  };
}

function buildInput(overrides: Partial<InstantPostInput> = {}): InstantPostInput {
  return {
    title: "Sunday Roast Special",
    prompt: "Classic Sunday roast with all the trimmings.",
    publishMode: "now",
    scheduledFor: undefined,
    platforms: ["facebook"],
    media: [],
    ctaUrl: undefined,
    linkInBioUrl: undefined,
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: false,
    includeEmojis: true,
    ctaStyle: "default",
    placement: "feed",
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 1: Platform personality sharpening
// ---------------------------------------------------------------------------

describe("platform personality sharpening", () => {
  describe("facebook guidance", () => {
    it("includes a comment-inviting question prompt instruction", () => {
      const result = buildInstantPostPrompt({
        brand: buildBrand(),
        input: buildInput(),
        platform: "facebook",
      });

      expect(result.user).toContain("invites comments");
      expect(result.user).toContain("Facebook rewards posts that generate replies");
    });

    it("includes conversational tone instruction", () => {
      const result = buildInstantPostPrompt({
        brand: buildBrand(),
        input: buildInput(),
        platform: "facebook",
      });

      expect(result.user).toContain("talking to a regular");
      expect(result.user).toContain("not announcement-style");
    });
  });

  describe("instagram guidance", () => {
    it("includes scroll-stopping first line instruction", () => {
      const result = buildInstantPostPrompt({
        brand: buildBrand(),
        input: buildInput({ platforms: ["instagram"] }),
        platform: "instagram",
      });

      expect(result.user).toContain("stop the scroll");
      expect(result.user).toContain("125 characters");
    });

    it("includes scannable structure instruction", () => {
      const result = buildInstantPostPrompt({
        brand: buildBrand(),
        input: buildInput({ platforms: ["instagram"] }),
        platform: "instagram",
      });

      expect(result.user).toContain("scannable structure");
      expect(result.user).toContain("One thought per line");
    });

    it("targets 60-80 words", () => {
      const result = buildInstantPostPrompt({
        brand: buildBrand(),
        input: buildInput({ platforms: ["instagram"] }),
        platform: "instagram",
      });

      expect(result.user).toContain("60-80 words");
    });
  });

});

// ---------------------------------------------------------------------------
// Task 2: Hook instruction integration
// ---------------------------------------------------------------------------

describe("hook instruction integration", () => {
  it("includes hookInstruction in adjustments when provided via context", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: {
        hookStrategy: "question",
        hookInstruction: "Open with a question that invites a response from the reader.",
      },
    });

    expect(result.user).toContain("Hook style: Open with a question that invites a response from the reader.");
  });

  it("omits hook instruction when hookStrategy is not provided", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: {},
    });

    expect(result.user).not.toContain("Hook style:");
  });

  it("omits hook instruction when hookInstruction is missing even if hookStrategy is set", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: { hookStrategy: "question" },
    });

    expect(result.user).not.toContain("Hook style:");
  });

  it("ignores non-string hookInstruction values", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: { hookStrategy: "question", hookInstruction: 123 },
    });

    expect(result.user).not.toContain("Hook style:");
  });
});

// ---------------------------------------------------------------------------
// Task 3: Pillar nudge integration
// ---------------------------------------------------------------------------

describe("pillar nudge integration", () => {
  it("includes content pillar nudge when provided via context", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: { pillarNudge: "Focus on the food and drink experience." },
    });

    expect(result.user).toContain("Content angle advisory:");
    expect(result.user).toContain("Focus on the food and drink experience.");
  });

  it("omits pillar nudge when not provided", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: {},
    });

    expect(result.user).not.toContain("Content angle advisory:");
  });

  it("omits pillar nudge when value is empty string", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: { pillarNudge: "   " },
    });

    expect(result.user).not.toContain("Content angle advisory:");
  });

  it("trims whitespace from pillar nudge", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: { pillarNudge: "  Community and belonging.  " },
    });

    expect(result.user).toContain("Content angle advisory:\nCommunity and belonging.");
  });

  it("places pillar nudge before platform guidance", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      context: { pillarNudge: "Focus on the food experience." },
    });

    const nudgeIndex = result.user.indexOf("Content angle advisory:");
    const platformIndex = result.user.indexOf("Platform guidance:");
    expect(nudgeIndex).toBeGreaterThan(-1);
    expect(platformIndex).toBeGreaterThan(-1);
    expect(nudgeIndex).toBeLessThan(platformIndex);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Temporal proximity integration
// ---------------------------------------------------------------------------

describe("temporal proximity integration", () => {
  it("includes temporal proximity tone cue when provided via context", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      scheduledFor: new Date("2026-03-15T19:00:00.000Z"),
      context: { temporalProximity: "This is a same-day post — write with urgency and excitement." },
    });

    expect(result.user).toContain("Timing tone: This is a same-day post — write with urgency and excitement.");
  });

  it("omits temporal proximity when not provided", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      scheduledFor: new Date("2026-03-15T19:00:00.000Z"),
      context: {},
    });

    expect(result.user).not.toContain("Timing tone:");
  });

  it("places temporal proximity before CTA label", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      scheduledFor: new Date("2026-03-15T19:00:00.000Z"),
      context: {
        temporalProximity: "Early awareness — build anticipation.",
        ctaLabel: "Book now",
      },
    });

    const toneIndex = result.user.indexOf("Timing tone:");
    const ctaIndex = result.user.indexOf("CTA label to use:");
    expect(toneIndex).toBeGreaterThan(-1);
    expect(ctaIndex).toBeGreaterThan(-1);
    expect(toneIndex).toBeLessThan(ctaIndex);
  });
});
