import { describe, expect, it } from "vitest";

import { INSTAGRAM_HASHTAG_LIMIT, buildInstantPostPrompt, buildSystemPrompt, buildUserPrompt, pickKeyPhrases } from "@/lib/ai/prompts";
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
    // One timing block owns every date claim.
    expect(prompt).toContain("Timing (Europe/London):");
    expect(prompt).toContain("This post publishes on Tuesday 26th May at 10am.");
    expect(prompt).toContain("The event is on Wednesday 27th May at 7pm, the day after this post publishes.");
    expect(prompt).toContain('You may describe it as happening "tomorrow".');
    expect(prompt).toContain('Do not describe it as happening "today", "tonight", "this Wednesday" or "next Wednesday"');
    // The internal enum label used to leak into the prompt.
    expect(prompt).not.toContain("Timing label:");
    // The raw ISO date was a second, differently formatted copy of the same fact.
    expect(prompt).not.toContain("Event date: 2026-05-27");
    // The uppercase overlay label must NOT be fed into the body prompt — it was
    // leaking abbreviated/relative date styling ("this FRI 17 JUL") into copy.
    expect(prompt).not.toContain("Overlay label:");
    expect(prompt).toContain("Timing intent: Write this as a next-day reminder");
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

describe("buildSystemPrompt business type", () => {
  const PUB_ONLY = ["hospitality", "landlord", "Sunday roast", "pint", "The Anchor", "a regular"];

  it("keeps the pub house style when the brand has no business type", () => {
    for (const brand of [undefined, buildBrand(), buildBrand({ businessType: "   " })]) {
      const prompt = buildSystemPrompt("event", "friendly_warm", undefined, brand);

      expect(prompt).toContain("You are CheersAI, an expert hospitality social media copywriter.");
      expect(prompt).toContain("the way a landlord would");
      expect(prompt).toContain("Examples of the right style:");
      expect(prompt).toContain("Sunday roast");
      expect(prompt).not.toContain("Business type:");
    }
  });

  it("writes for the brand's own business and drops the pub-only wording", () => {
    const prompt = buildSystemPrompt(
      "instant_post",
      "friendly_warm",
      undefined,
      buildBrand({
        keyPhrases: [],
        businessType: " websites and applications company ",
        businessDescription: " Orange Jelly builds websites and connected systems. ",
      }),
    );

    expect(prompt).toContain("You are CheersAI, an expert social media copywriter.");
    expect(prompt).toContain("Business type: websites and applications company.");
    expect(prompt).toContain("About the business: Orange Jelly builds websites and connected systems.");
    expect(prompt).toContain("Do not write as a pub or hospitality venue unless the business type says it is one.");
    expect(prompt).toContain("talking to a customer");
    expect(prompt).toContain("Grammar and point of view:");
    // Shared rules still apply to every brand.
    expect(prompt).toContain("Do not invent operational details");
    expect(prompt).toContain("Never use an em dash.");

    const withoutGuard = prompt.replace(
      "Do not write as a pub or hospitality venue unless the business type says it is one.",
      "",
    );
    for (const phrase of PUB_ONLY) {
      expect(withoutGuard).not.toContain(phrase);
    }
  });

  it("ignores a description when no business type is set", () => {
    const prompt = buildSystemPrompt(
      "event",
      "friendly_warm",
      undefined,
      buildBrand({ businessDescription: "We are a pub in Stanwell Moor." }),
    );

    expect(prompt).not.toContain("About the business:");
  });
});

describe("house style in the v2 prompts (tasks/SPEC-event-copy-engine.md B1)", () => {
  it("teaches from briefs, not stock openings, and keeps the examples out of the post", () => {
    const prompt = buildSystemPrompt("event", "friendly_warm", undefined, buildBrand());
    expect(prompt).toContain("The examples show the style only. Never copy their facts");
    expect(prompt).toContain("Brief: Disco Night Music Bingo");
    expect(prompt).not.toMatch(/Join us for a proper Sunday roast|perfect spot|just the ticket|Who are you backing/);
    expect(prompt).toContain('never a generic greeting or a stock opening such as "Get ready", "Join us"');
    expect(prompt).toContain('Say "join us" at most once');
    expect(prompt).toContain("Write times as 7pm or 7:30pm, never 7:00pm or 19:00.");
  });

  it("asks for at most one real question and never comment bait", () => {
    const prompt = buildSystemPrompt("event", "friendly_warm", undefined, buildBrand());
    expect(prompt).toContain("Questions: ask at most one");
    expect(prompt).toContain("never ask people to tag, share, like or comment");
    expect(prompt).not.toContain("close the body with a short question");
  });

  it("sends the brand's own hashtags and emojis, with Instagram's five-hashtag limit", () => {
    const system = buildSystemPrompt("event", "friendly_warm", undefined, buildBrand());
    expect(system).toContain("The brand's own hashtags, to use first whenever hashtags are wanted: #cheers #publife.");
    expect(system).toContain("Emojis that suit the brand, whenever emojis are wanted: 🍺 😊.");
    const brief = { ...buildEventBrief(), includeHashtags: true, includeEmojis: true };
    const user = buildUserPrompt(brief);
    expect(user).toContain(`at most ${INSTAGRAM_HASHTAG_LIMIT} on Instagram`);
    expect(user).toContain("Never use a person's name as a hashtag");
    expect(user).toContain("Use one or two emojis where they add something");
  });

  it("offers one or two key phrases per post, rotated by slot", () => {
    const phrases = ["Proper pub food", "Bring your mates", "Free on-site parking", "Your local in Stanwell Moor"];
    expect(pickKeyPhrases(phrases, "Event day|2026-11-13T07:00")).toHaveLength(2);
    const picks = new Set(["a", "b", "c", "d", "e", "f"].map((seed) => pickKeyPhrases(phrases, seed).join("|")));
    expect(picks.size).toBeGreaterThan(1);
    expect(pickKeyPhrases(phrases, "same")).toEqual(pickKeyPhrases(phrases, "same"));
    expect(pickKeyPhrases(["Only one"], "x")).toEqual(["Only one"]);
    const prompt = buildSystemPrompt("event", "friendly_warm", undefined, buildBrand({ keyPhrases: phrases }), { keyPhraseSeed: "a" });
    expect(prompt.match(/Weave in one of these phrases only if it fits naturally: (.*)\./)?.[1].split(", ")).toHaveLength(2);
  });
});

function buildEventBrief(): ContentBrief {
  return {
    contentType: "event",
    title: "Quiz Night",
    prompt: "Teams of up to six.",
    platforms: ["facebook", "instagram"],
    tone: "friendly_warm",
    lengthPreference: "standard",
    includeHashtags: false,
    includeEmojis: false,
    ctaStyle: "default",
    proofPoints: [],
    eventName: "Quiz Night",
    eventDate: "2026-11-04",
    eventTime: "19:30",
    placements: ["feed"],
  } as unknown as ContentBrief;
}

describe("event fact sheet in the user prompt (tasks/SPEC-event-copy-engine.md B2)", () => {
  it("renders the venue's facts as the only facts to use, and labels imported notes", () => {
    const brief = {
      ...buildEventBrief(),
      prompt: "Get ready for a huge themed Friday night.",
      facts: {
        category: "Music Bingo",
        times: "7pm to 10pm; doors 6:30pm",
        price: "£5 per person, paid in cash on arrival",
        booking: "Shared tables: book a place for each person",
        host: "Nikki Manfadge",
        faqs: [{ question: "Is there an age limit?", answer: "All ages welcome." }],
      },
    } as unknown as ContentBrief;
    const prompt = buildUserPrompt(brief);
    expect(prompt).toContain("Venue notes (facts to draw on; never reuse their headline or wording): Get ready");
    expect(prompt).toContain("Use only these facts.");
    expect(prompt).toContain("- Times: 7pm to 10pm; doors 6:30pm");
    expect(prompt).toContain("- Price: £5 per person, paid in cash on arrival");
    expect(prompt).toContain("- Host: Nikki Manfadge");
    expect(prompt).toContain("- Is there an age limit? All ages welcome.");
  });

  it("keeps the plain description label when there are no facts", () => {
    const prompt = buildUserPrompt({ ...buildEventBrief(), prompt: "Teams of six." } as ContentBrief);
    expect(prompt).toContain("Description: Teams of six.");
    expect(prompt).not.toContain("Event facts from the venue");
  });
});
