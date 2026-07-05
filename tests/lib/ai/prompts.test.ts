import { describe, expect, it } from "vitest";

import { buildInstantPostPrompt, buildSystemPrompt, buildUserPrompt } from "@/lib/ai/prompts";
import { buildGenerationTemporalContext } from "@/lib/create/temporal-context";
import type { ContentBrief } from "@/features/create/schemas/content-schemas";
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

  it("maps the formality slider to the settings UI direction", () => {
    const casual = buildInstantPostPrompt({
      brand: buildBrand({ toneFormal: 0.8 }),
      input: buildInput(),
      platform: "facebook",
    });
    const formal = buildInstantPostPrompt({
      brand: buildBrand({ toneFormal: 0.2 }),
      input: buildInput(),
      platform: "facebook",
    });

    expect(casual.system).toContain("Formality is very casual");
    expect(formal.system).toContain("Formality is formal");
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

describe("buildUserPrompt", () => {
  it("tells the structured generator not to clone captions across platforms", () => {
    const prompt = buildSystemPrompt("event", "friendly_warm");

    expect(prompt).toContain("Do not clone the same caption twice");
    expect(prompt).toContain("Do not invent operational details");
  });

  it("includes restored relative-date timing context for redesigned wizard event copy", () => {
    const brief = {
      title: "Quiz Night",
      prompt: "A weekly pub quiz with prizes.",
      platforms: ["facebook"],
      tone: "friendly_warm",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      proofPoints: [],
      contentType: "event",
      placements: ["feed"],
      eventName: "Quiz Night",
      eventDate: "2026-05-27",
      eventTime: "19:00",
    } satisfies ContentBrief;
    const scheduledAt = "2026-05-26T10:00:00.000+01:00";
    const temporalContext = buildGenerationTemporalContext({
      contentType: brief.contentType,
      brief,
      scheduledAt,
    });

    const prompt = buildUserPrompt(brief, undefined, {
      scheduledAt,
      slotLabel: "1 day to go",
      ...temporalContext,
    });

    expect(prompt).toContain("Timing tone: anticipation");
    expect(prompt).toContain("Timing label: tomorrow");
    // The uppercase overlay label must NOT be fed into the body prompt — it was
    // leaking abbreviated/relative date styling ("this FRI 17 JUL") into copy.
    expect(prompt).not.toContain("Overlay label:");
    expect(prompt).toContain("Relative date wording: The event is tomorrow");
    expect(prompt).toContain("Accuracy guardrails");
    expect(prompt).toContain("do not invent booking requirements");
  });

  it("adds CTA link handling instructions without putting URLs into the prompt", () => {
    const brief = {
      title: "Live Jazz",
      prompt: "A live jazz night with local artists.",
      platforms: ["facebook", "instagram"],
      tone: "friendly_warm",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      proofPoints: [],
      contentType: "event",
      placements: ["feed"],
      eventName: "Live Jazz",
      eventDate: "2026-06-05",
      eventTime: "20:00",
      ctaLinks: {
        facebook: "https://vip-club.uk/fb-live-jazz",
        instagram: "https://vip-club.uk/bio-live-jazz",
      },
    } satisfies ContentBrief;

    const prompt = buildUserPrompt(brief);

    expect(prompt).toContain("CTA links:");
    expect(prompt).toContain("Facebook event CTA URL is available");
    expect(prompt).toContain("Instagram event link-in-bio destination is available");
    expect(prompt).not.toContain("https://vip-club.uk/fb-live-jazz");
    expect(prompt).not.toContain("https://vip-club.uk/bio-live-jazz");
    expect(prompt).toContain("instagram.link_in_bio_line");
    expect(prompt).toContain("Do not put any URL, bare domain, direct booking link");
  });
});
