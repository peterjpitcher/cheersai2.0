import { describe, expect, it } from "vitest";

import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { BANNED_PHRASES } from "@/lib/ai/voice";
import type { InstantPostInput } from "@/lib/create/schema";
import type { BrandProfile } from "@/lib/settings/data";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildBrand(overrides: Partial<BrandProfile> = {}): BrandProfile {
  return {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: ["good food and a warm welcome", "book a table"],
    bannedTopics: [],
    bannedPhrases: [],
    defaultHashtags: ["#cheers", "#publife"],
    defaultEmojis: ["🍺", "😊"],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: "LEARN_MORE",
    ...overrides,
  };
}

function buildInput(overrides: Partial<InstantPostInput> = {}): InstantPostInput {
  return {
    title: "Sunday Roast Special",
    prompt: "We are serving a classic Sunday roast with all the trimmings.",
    publishMode: "now",
    scheduledFor: undefined,
    platforms: ["facebook"],
    media: [],
    ctaUrl: "https://example.com/book",
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
// Tests
// ---------------------------------------------------------------------------

describe("buildInstantPostPrompt", () => {
  it("returns an object with system and user string properties for facebook", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
    });

    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("returns system and user strings for instagram", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ platforms: ["instagram"] }),
      platform: "instagram",
    });

    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
  });

  it("returns system and user strings for gbp", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ platforms: ["gbp"] }),
      platform: "gbp",
    });

    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
  });

  it("includes system-level banned phrases in the system prompt", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
    });

    // The system prompt should reference at least one known banned phrase from voice.ts
    const firstBanned = BANNED_PHRASES[0];
    expect(result.system).toContain(firstBanned);
  });

  it("includes brand-level banned phrases merged into the system prompt", () => {
    const brand = buildBrand({ bannedPhrases: ["amazing deals", "limited time only"] });

    const result = buildInstantPostPrompt({
      brand,
      input: buildInput(),
      platform: "facebook",
    });

    expect(result.system).toContain("amazing deals");
    expect(result.system).toContain("limited time only");
  });

  it("does not duplicate a brand phrase that already appears in the system banned list", () => {
    // "unforgettable experience" is already in BANNED_PHRASES
    const brand = buildBrand({ bannedPhrases: ["unforgettable experience"] });

    const result = buildInstantPostPrompt({
      brand,
      input: buildInput(),
      platform: "facebook",
    });

    // Appears at least once (from system list) but not duplicated
    const occurrences = (result.system.match(/unforgettable experience/gi) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("includes the venue name in the system prompt when provided", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
      venueName: "The Anchor",
    });

    expect(result.system).toContain("The Anchor");
  });

  it("instructs not to name the venue when venueName is omitted", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
    });

    expect(result.system).toContain("Do not name the venue");
  });

  it("includes the prompt text in the user message", () => {
    const prompt = "We have a special quiz night this Thursday starting at 7pm.";
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ prompt }),
      platform: "facebook",
    });

    expect(result.user).toContain(prompt);
  });

  it("includes the title in the user message", () => {
    const title = "Quiz Night Bonanza";
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ title }),
      platform: "facebook",
    });

    expect(result.user).toContain(title);
  });

  it("instagram guidance mentions word limit of 80 words", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ platforms: ["instagram"] }),
      platform: "instagram",
    });

    expect(result.user).toMatch(/80 words/i);
  });

  it("gbp guidance mentions word/character hard limit", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ platforms: ["gbp"] }),
      platform: "gbp",
    });

    expect(result.user).toMatch(/150 words|900 characters/i);
  });

  it("gbp guidance differs from facebook guidance", () => {
    const facebook = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ platforms: ["facebook"] }),
      platform: "facebook",
    });

    const gbp = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ platforms: ["gbp"] }),
      platform: "gbp",
    });

    expect(facebook.user).not.toBe(gbp.user);
  });

  it("includes scheduled time context in the user message when scheduledFor is provided", () => {
    const scheduledFor = new Date("2026-03-15T19:00:00.000Z");

    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ publishMode: "schedule", scheduledFor }),
      platform: "facebook",
      scheduledFor,
    });

    // Timing and context block should appear
    expect(result.user).toContain("Timing and context");
  });

  it("does not include timing block when scheduledFor is not provided", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput(),
      platform: "facebook",
    });

    expect(result.user).not.toContain("Timing and context");
  });

  it("includes key phrases from the brand in the user message", () => {
    const brand = buildBrand({ keyPhrases: ["cosy corners", "dog friendly"] });

    const result = buildInstantPostPrompt({
      brand,
      input: buildInput(),
      platform: "facebook",
    });

    expect(result.user).toContain("cosy corners");
    expect(result.user).toContain("dog friendly");
  });

  it("includes GBP CTA instruction in gbp platform guidance", () => {
    const brand = buildBrand({ gbpCta: "BOOK" });

    const result = buildInstantPostPrompt({
      brand,
      input: buildInput({ platforms: ["gbp"] }),
      platform: "gbp",
    });

    expect(result.user).toContain("BOOK");
  });

  it("falls back to LEARN_MORE CTA for gbp when gbpCta is not set on brand", () => {
    const brand = buildBrand({ gbpCta: undefined });

    const result = buildInstantPostPrompt({
      brand,
      input: buildInput({ platforms: ["gbp"] }),
      platform: "gbp",
    });

    expect(result.user).toContain("LEARN_MORE");
  });

  it("notes media assets in the user message when provided", () => {
    const input = buildInput({
      media: [{ assetId: "abc123", mediaType: "image", fileName: "roast.jpg" }],
    });

    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input,
      platform: "facebook",
    });

    expect(result.user).toContain("roast.jpg");
  });

  it("indicates no media when media array is empty", () => {
    const result = buildInstantPostPrompt({
      brand: buildBrand(),
      input: buildInput({ media: [] }),
      platform: "facebook",
    });

    expect(result.user).toContain("Media: none provided");
  });
});
