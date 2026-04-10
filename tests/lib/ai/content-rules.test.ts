import { describe, expect, it } from "vitest";

import { applyChannelRules, lintContent, removeTrailingEllipses } from "@/lib/ai/content-rules";
import { PROOF_POINTS, type ProofPoint } from "@/lib/ai/proof-points";

const ORIGINAL_PROOF_POINTS = [...PROOF_POINTS];
const SAMPLE_PROOF_POINT: ProofPoint = {
  id: "parking",
  variants: ["Free parking available."],
  allowedChannels: ["facebook", "instagram", "gbp"],
  allowedUseCases: ["event", "promotion", "weekly", "instant"],
  intentTags: ["convenience"],
};

describe("content rules", () => {
  const resetProofPoints = () => {
    PROOF_POINTS.length = 0;
    PROOF_POINTS.push(...ORIGINAL_PROOF_POINTS);
  };

  const installProofPoint = () => {
    PROOF_POINTS.length = 0;
    PROOF_POINTS.push(SAMPLE_PROOF_POINT);
  };

  it("removes link-in-bio language when no link exists on Instagram", () => {
    const { body } = applyChannelRules({
      body: "Join us tonight. Link in bio for details.",
      platform: "instagram",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).not.toContain("link in bio");
  });

  it("adds link-in-bio line when a link exists on Instagram", () => {
    const { body } = applyChannelRules({
      body: "Join us tonight for live music.",
      platform: "instagram",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book", ctaLabel: "Book now" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).toContain("Book now via the link in our bio.");
  });

  it("enforces GBP hard rules (no hashtags, no link-in-bio, max length)", () => {
    const longBody = `${"Great food and drink. ".repeat(60)} Link in bio for details. #pubnight`;
    const { body } = applyChannelRules({
      body: longBody,
      platform: "gbp",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: true, includeEmojis: true },
    });

    expect(body.toLowerCase()).not.toContain("link in bio");
    expect(body).not.toContain("#");
    expect(body.length).toBeLessThanOrEqual(900);
  });

  it("flags blocked tokens in lint", () => {
    const lint = lintContent({
      body: "Come down tonight. undefined",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "blocked_tokens")).toBe(true);
  });

  it("removes disallowed claims for missing fields", () => {
    const { body } = applyChannelRules({
      body: "Limited spaces left, tickets are £10 and we go until 2am.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).not.toContain("limited spaces");
    // £10 (price claim) is intentionally not removed — price patterns were removed to allow
    // user-specified prices to pass through (see content-rules.ts CLAIM_PATTERNS comment)
    expect(body.toLowerCase()).not.toContain("until 2am");
  });

  it("removes proof points when mode is off", () => {
    installProofPoint();
    const { body } = applyChannelRules({
      body: "Free parking available.\nJoin us tonight.",
      platform: "facebook",
      placement: "feed",
      context: { useCase: "event", proofPointMode: "off" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).not.toContain("free parking");
    resetProofPoints();
  });

  it("adds selected proof points when enabled", () => {
    installProofPoint();
    const { body } = applyChannelRules({
      body: "Join us tonight.",
      platform: "facebook",
      placement: "feed",
      context: { useCase: "event", proofPointMode: "selected", proofPointsSelected: ["parking"] },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).toContain("Free parking available.");
    resetProofPoints();
  });

  it("does not auto-insert proof points when none are present", () => {
    installProofPoint();
    const { body } = applyChannelRules({
      body: "Join us tonight.",
      platform: "facebook",
      placement: "feed",
      context: { useCase: "event", proofPointMode: "auto", proofPointIntentTags: ["convenience"] },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).not.toContain("Free parking available.");
    resetProofPoints();
  });

  it("flags disallowed proof points in lint", () => {
    installProofPoint();
    const lint = lintContent({
      body: "Free parking available.",
      platform: "facebook",
      placement: "feed",
      context: { useCase: "event", proofPointMode: "off" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "proof_point_disallowed")).toBe(true);
    resetProofPoints();
  });

  it("scrubs banned phrases and reduces hype", () => {
    const { body } = applyChannelRules({
      body: "An unforgettable experience and the best night in town awaits.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).not.toContain("unforgettable experience");
    expect(body.toLowerCase()).not.toContain("the best");
  });

  it("flags banned phrases in lint", () => {
    const lint = lintContent({
      body: "Join us for an electrifying night.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "banned_phrases")).toBe(true);
  });

  it("replaces day names when they do not match the reference date", () => {
    const scheduledFor = new Date("2026-02-05T12:00:00Z"); // Thursday in Europe/London
    const { body } = applyChannelRules({
      body: "Join us this Friday for a pint.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
      scheduledFor,
    });

    expect(body).toContain("Thursday");
    expect(body).not.toContain("Friday");
  });
});

describe("applyChannelRules — Facebook feed", () => {
  it("removes non-CTA URLs and appends CTA URL when provided", () => {
    const { body } = applyChannelRules({
      body: "Check out https://random.example.com for details.",
      platform: "facebook",
      placement: "feed",
      context: { ctaUrl: "https://anchor.pub/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).not.toContain("https://random.example.com");
    expect(body).toContain("https://anchor.pub/book");
  });

  it("trims hashtags to 3", () => {
    const { body } = applyChannelRules({
      body: "Great night out. #pub #livemusic #food #beer #local #community",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: true, includeEmojis: false },
    });

    const hashtags = body.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    expect(hashtags.length).toBeLessThanOrEqual(3);
  });
});

describe("applyChannelRules — Instagram feed", () => {
  it("enforces 80-word limit", () => {
    const longBody = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const { body } = applyChannelRules({
      body: longBody,
      platform: "instagram",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(80);
  });

  it("adds link-in-bio line when URL provided", () => {
    const { body } = applyChannelRules({
      body: "Join us for live music tonight.",
      platform: "instagram",
      placement: "feed",
      context: { ctaUrl: "https://example.com/event", ctaLabel: "Book tickets" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).toContain("link in our bio");
  });

  it("trims hashtags to 6", () => {
    const { body } = applyChannelRules({
      body: "Good food. #pub #beer #food #livemusic #local #community #surrey #uk",
      platform: "instagram",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: true, includeEmojis: false },
    });

    const hashtags = body.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    expect(hashtags.length).toBeLessThanOrEqual(6);
  });

  it("trims emojis to 3", () => {
    const { body } = applyChannelRules({
      body: "Great night out. \u{1F37B}\u{1F37A}\u{1F355}\u{1F3B5}\u{1F389}",
      platform: "instagram",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: true },
    });

    const emojis = body.match(/\p{Extended_Pictographic}/gu) ?? [];
    expect(emojis.length).toBeLessThanOrEqual(3);
  });
});

describe("applyChannelRules — GBP feed", () => {
  it("removes hashtags entirely", () => {
    const { body } = applyChannelRules({
      body: "Join us tonight. #pubnight #food",
      platform: "gbp",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: true, includeEmojis: false },
    });

    expect(body).not.toContain("#");
  });

  it("enforces 900-character limit", () => {
    const longBody = "A".repeat(1000);
    const { body } = applyChannelRules({
      body: longBody,
      platform: "gbp",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.length).toBeLessThanOrEqual(900);
  });

  it("trims emojis to 2", () => {
    const { body } = applyChannelRules({
      body: "Great food. \u{1F37B}\u{1F37A}\u{1F355}\u{1F3B5}",
      platform: "gbp",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: true },
    });

    const emojis = body.match(/\p{Extended_Pictographic}/gu) ?? [];
    expect(emojis.length).toBeLessThanOrEqual(2);
  });
});

describe("applyChannelRules — Story", () => {
  it("returns empty body regardless of input", () => {
    const { body } = applyChannelRules({
      body: "This is a story caption that should be removed.",
      platform: "facebook",
      placement: "story",
      context: {},
    });

    expect(body).toBe("");
  });
});

describe("lintContent", () => {
  it("passes for a clean Facebook post and returns metrics", () => {
    const lint = lintContent({
      body: "Join us for live music tonight.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(true);
    expect(lint.metrics.wordCount).toBeGreaterThan(0);
    expect(lint.metrics.charCount).toBeGreaterThan(0);
  });

  it("fails for Instagram post over 80 words with word_limit issue", () => {
    const longBody = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const lint = lintContent({
      body: longBody,
      platform: "instagram",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "word_limit")).toBe(true);
  });

  it("fails for GBP post with hashtags with gbp_hashtags issue", () => {
    const lint = lintContent({
      body: "Good food tonight. #pubnight",
      platform: "gbp",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: true, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "gbp_hashtags")).toBe(true);
  });

  it("fails for post with blocked token 'undefined'", () => {
    const lint = lintContent({
      body: "Come tonight. undefined",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "blocked_tokens")).toBe(true);
  });

  it("handles empty body", () => {
    const lint = lintContent({
      body: "",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.metrics.wordCount).toBe(0);
    expect(lint.metrics.charCount).toBe(0);
  });
});

describe("removeTrailingEllipses", () => {
  it("removes triple dots", () => {
    expect(removeTrailingEllipses("Hello...")).toBe("Hello");
  });

  it("removes unicode ellipsis", () => {
    expect(removeTrailingEllipses("Hello\u2026")).toBe("Hello");
  });

  it("leaves string without ellipsis unchanged", () => {
    expect(removeTrailingEllipses("Hello")).toBe("Hello");
  });
});
