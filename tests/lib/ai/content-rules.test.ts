import { describe, expect, it } from "vitest";

import { applyChannelRules, lintContent } from "@/lib/ai/content-rules";
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
    expect(body).not.toContain("£10");
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
