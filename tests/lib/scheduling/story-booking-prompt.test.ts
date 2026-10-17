// tests/lib/scheduling/story-booking-prompt.test.ts
//
// The booking prompt drawn on event stories (tasks/SPEC-story-booking-prompt.md).
// The Deno worker copy is held to the same answers by
// proximity-label-parity.test.ts.
import { describe, expect, it } from "vitest";
import {
  STORY_PROMPT_FACEBOOK_FALLBACK,
  STORY_PROMPT_INSTAGRAM,
  getStoryBookingPrompt,
  type StoryBookingPromptInput,
} from "@/lib/scheduling/proximity-label";
import { readPlatformCtaLinks, resolvePlatformCtaUrl } from "@/lib/publishing/copy-rules";
import { BANNER_TEXT_PATTERN, MAX_STORY_PROMPT_LENGTH } from "@/lib/banner/text";

// What a wizard-created event story carries today (live, 17 October 2026).
const EVENT_BRIEF_CONTEXT = {
  slotKey: "slot-1",
  placement: "story",
  brief: {
    ctaLinks: {
      facebook: "https://l.the-anchor.pub/fb6e761f",
      instagram: "https://l.the-anchor.pub/ig6e761f",
    },
  },
};

function input(overrides: Partial<StoryBookingPromptInput> = {}): StoryBookingPromptInput {
  return {
    platform: "facebook",
    placement: "story",
    campaignType: "event",
    promptContext: EVENT_BRIEF_CONTEXT,
    websiteUrl: "https://www.the-anchor.pub",
    ...overrides,
  };
}

describe("getStoryBookingPrompt", () => {
  it("gives The Anchor's Facebook stories the approved text", () => {
    expect(getStoryBookingPrompt(input())).toBe("BOOK AT THE-ANCHOR.PUB");
  });

  it("gives Instagram stories the approved text, whatever the website", () => {
    expect(getStoryBookingPrompt(input({ platform: "instagram" }))).toBe(STORY_PROMPT_INSTAGRAM);
    expect(getStoryBookingPrompt(input({ platform: "instagram", websiteUrl: null }))).toBe(
      "LINK IN BIO TO BOOK",
    );
  });

  it("names the domain from the brand's website, not from the short booking link", () => {
    expect(getStoryBookingPrompt(input({ websiteUrl: "https://www.example-inn.co.uk/events?x=1#top" }))).toBe(
      "BOOK AT EXAMPLE-INN.CO.UK",
    );
    expect(getStoryBookingPrompt(input({ websiteUrl: "http://Book.Example.com/" }))).toBe(
      "BOOK AT BOOK.EXAMPLE.COM",
    );
    expect(getStoryBookingPrompt(input({ websiteUrl: "  the-anchor.pub  " }))).toBe("BOOK AT THE-ANCHOR.PUB");
  });

  it.each([
    ["no website", null],
    ["a blank website", "   "],
    ["junk", "not a website"],
    ["an IP address", "http://192.168.0.1"],
    ["localhost", "http://localhost:3000"],
    ["another scheme", "mailto:hello@example.com"],
    ["credentials in the address", "https://user:pass@example.com"],
    ["an international domain in xn-- form", "https://xn--caf-dma.com"],
    ["a domain too long for the cap", `https://www.${"a".repeat(30)}.com`],
  ])("falls back to the generic Facebook text for %s", (_case, websiteUrl) => {
    expect(getStoryBookingPrompt(input({ websiteUrl }))).toBe(STORY_PROMPT_FACEBOOK_FALLBACK);
  });

  it("returns nothing for feed posts", () => {
    expect(getStoryBookingPrompt(input({ placement: "feed" }))).toBeNull();
    expect(getStoryBookingPrompt(input({ placement: "feed", platform: "instagram" }))).toBeNull();
  });

  it.each(["promotion", "weekly", null, undefined])(
    "returns nothing for a story that is not an event (%s)",
    (campaignType) => {
      expect(getStoryBookingPrompt(input({ campaignType }))).toBeNull();
    },
  );

  it("returns nothing when the story's own platform has no booking link", () => {
    const facebookOnly = { brief: { ctaLinks: { facebook: "https://l.the-anchor.pub/fb1" } } };
    const instagramOnly = { brief: { ctaLinks: { instagram: "https://l.the-anchor.pub/ig1" } } };
    expect(getStoryBookingPrompt(input({ platform: "instagram", promptContext: facebookOnly }))).toBeNull();
    expect(getStoryBookingPrompt(input({ platform: "facebook", promptContext: instagramOnly }))).toBeNull();
    expect(getStoryBookingPrompt(input({ platform: "facebook", promptContext: facebookOnly }))).toBe(
      "BOOK AT THE-ANCHOR.PUB",
    );
  });

  it.each([
    ["no prompt context", null],
    ["no brief", { slotKey: "x" }],
    ["no links", { brief: {} }],
    ["a link that is not http", { brief: { ctaLinks: { facebook: "javascript:alert(1)" } } }],
    ["a blank link", { brief: { ctaLinks: { facebook: "   " } } }],
    ["links as an array", { brief: { ctaLinks: ["https://l.the-anchor.pub/fb1"] } }],
  ])("returns nothing for %s", (_case, promptContext) => {
    expect(getStoryBookingPrompt(input({ promptContext }))).toBeNull();
  });

  it("returns nothing for platforms other than Facebook and Instagram", () => {
    expect(getStoryBookingPrompt(input({ platform: "gbp" }))).toBeNull();
    expect(getStoryBookingPrompt(input({ platform: null }))).toBeNull();
  });

  // The rule is meant to match the paired feed post's booking line exactly:
  // a story gets a prompt when, and only when, the feed post on that platform
  // gets "Book now: link" (Facebook) or the link-in-bio line (Instagram).
  it("agrees with the feed post's booking-line test for every brief", () => {
    const briefs: Array<Record<string, unknown>> = [
      { ctaLinks: { facebook: "https://a.example/1", instagram: "https://a.example/2" } },
      { ctaLinks: { facebook: "https://a.example/1" } },
      { ctaLinks: { instagram: " http://a.example/2 " } },
      { ctaLinks: { facebook: "ftp://a.example/1", instagram: "" } },
      { ctaLinks: { facebook: 42 } },
      { ctaLinks: null },
      {},
    ];
    for (const brief of briefs) {
      for (const platform of ["facebook", "instagram"] as const) {
        const feedHasBookingLine = resolvePlatformCtaUrl(platform, readPlatformCtaLinks(brief)) !== null;
        const storyHasPrompt = getStoryBookingPrompt(input({ platform, promptContext: { brief } })) !== null;
        expect(storyHasPrompt, `${platform} ${JSON.stringify(brief)}`).toBe(feedHasBookingLine);
      }
    }
  });

  it("only ever produces text the render route accepts", () => {
    const websites = [
      "https://www.the-anchor.pub",
      `https://${"b".repeat(28)}.com`,
      `https://${"b".repeat(29)}.com`,
      null,
    ];
    for (const websiteUrl of websites) {
      for (const platform of ["facebook", "instagram"]) {
        const prompt = getStoryBookingPrompt(input({ platform, websiteUrl }));
        expect(prompt).not.toBeNull();
        expect(prompt!.length).toBeLessThanOrEqual(MAX_STORY_PROMPT_LENGTH);
        expect(BANNER_TEXT_PATTERN.test(prompt!)).toBe(true);
      }
    }
  });
});
