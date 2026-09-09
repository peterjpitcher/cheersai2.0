import { describe, expect, it } from "vitest";

import { applyChannelRules, lintContent, removeTrailingEllipses } from "@/lib/ai/content-rules";
import { PROOF_POINTS, type ProofPoint } from "@/lib/ai/proof-points";

const ORIGINAL_PROOF_POINTS = [...PROOF_POINTS];
const SAMPLE_PROOF_POINT: ProofPoint = {
  id: "parking",
  variants: ["Free parking available."],
  allowedChannels: ["facebook", "instagram"],
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

  it("does not require Instagram link-in-bio in body for stories (empty body is intentional)", () => {
    const result = lintContent({
      body: "",
      platform: "instagram",
      placement: "story",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(true);
    expect(result.issues.find((issue) => issue.code === "link_in_bio_missing")).toBeUndefined();
  });

  it("still requires Instagram link-in-bio line in body for feed posts when a link is present", () => {
    const result = lintContent({
      body: "Join us tonight for live music.",
      platform: "instagram",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(false);
    expect(result.issues.some((issue) => issue.code === "link_in_bio_missing")).toBe(true);
  });

  it("passes story lint for all platforms with an empty body and a campaign cta", () => {
    for (const platform of ["facebook", "instagram"] as const) {
      const result = lintContent({
        body: "",
        platform,
        placement: "story",
        context: { ctaUrl: "https://example.com/book", linkInBioUrl: "https://example.com/menu" },
        advanced: { includeHashtags: true, includeEmojis: true },
      });
      expect(result.pass, `${platform} story should pass lint with empty body`).toBe(true);
    }
  });

  it("does not require Facebook CTA URL in body for stories (empty body is intentional)", () => {
    const result = lintContent({
      body: "",
      platform: "facebook",
      placement: "story",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(true);
    expect(result.issues.find((issue) => issue.code === "cta_url_missing")).toBeUndefined();
  });

  it("still requires Facebook CTA URL in body for feed posts", () => {
    const result = lintContent({
      body: "Join us tonight for live music.",
      platform: "facebook",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(false);
    expect(result.issues.some((issue) => issue.code === "cta_url_missing")).toBe(true);
  });

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

  it("removes bare booking domains from Instagram and uses link-in-bio wording", () => {
    const { body } = applyChannelRules({
      body: "Join us tonight for live music. Book now at the-anchor.pub/book-table",
      platform: "instagram",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book", ctaLabel: "Book now" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).toContain("Join us tonight for live music.");
    expect(body).toContain("Book now via the link in our bio.");
    expect(body).not.toContain("the-anchor.pub");
    expect(body).not.toContain("Book now at");
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

  it("replaces a single day name that does not match the event date", () => {
    const { body } = applyChannelRules({
      body: "Join us this Friday for a pint.",
      platform: "facebook",
      placement: "feed",
      context: { eventStart: "2026-02-05T19:00:00+00:00" }, // Thursday
      advanced: { includeHashtags: false, includeEmojis: false },
      scheduledFor: new Date("2026-02-03T12:00:00Z"),
    });

    expect(body).toContain("Thursday");
    expect(body).not.toContain("Friday");
  });

  it("does not rewrite a day name against the publish date alone", () => {
    // "Live music Saturday" scheduled for a Tuesday is not a mistake: the
    // publish day is not the subject of the post. This used to become
    // "Live music Tuesday".
    const { body } = applyChannelRules({
      body: "Live music Saturday with the band.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
      scheduledFor: new Date("2026-02-03T12:00:00Z"), // Tuesday
    });

    expect(body).toContain("Saturday");
    expect(body).not.toContain("Tuesday");
  });

  it("leaves copy alone when it names two different days", () => {
    // Previously deleted every weekday, producing "Join us . roast follows."
    const { body } = applyChannelRules({
      body: "Join us Saturday. Sunday roast follows.",
      platform: "facebook",
      placement: "feed",
      context: { eventStart: "2026-02-07T19:00:00+00:00" }, // Saturday
      advanced: { includeHashtags: false, includeEmojis: false },
      scheduledFor: new Date("2026-02-03T12:00:00Z"),
    });

    expect(body).toBe("Join us Saturday. Sunday roast follows.");
  });

  it("leaves copy alone when there is no structured date to judge against", () => {
    const { body } = applyChannelRules({
      body: "Join us Saturday for live music.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
      scheduledFor: null,
    });

    expect(body).toBe("Join us Saturday for live music.");
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

  it("fails Instagram lint when a bare domain is present", () => {
    const lint = lintContent({
      body: "Book now at the-anchor.pub/book-table",
      platform: "instagram",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "url_disallowed")).toBe(true);
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

describe("day-name lint", () => {
  const lint = (body: string, context: Record<string, unknown> | null, scheduledFor: Date | null) =>
    lintContent({ body, platform: "facebook", placement: "feed", context, scheduledFor });

  const dayIssue = (result: ReturnType<typeof lint>) =>
    result.issues.find((issue) => issue.code === "day_name_mismatch");

  it("no longer blocks copy that names a second, legitimate day", () => {
    // The event is Saturday; the Sunday roast is real copy, not a mistake.
    // A set of dates cannot know that Sunday is legitimate, so the mismatch is
    // still reported, but it must not stop the post being approved. Before this
    // change, naming any second weekday failed the lint and blocked approval.
    const result = lint(
      "Our quiz lands on Saturday 19th September at 7pm. Stick around, our Sunday roast is served from noon the day after.",
      { eventStart: "2026-09-19T19:00:00+01:00" },
      new Date("2026-09-14T10:00:00+01:00"),
    );

    expect(dayIssue(result)?.message).toContain("sunday");
    expect(result.pass).toBe(true);
  });

  it("accepts weekly recurring wording that names the occurrence day", () => {
    // The post publishes Monday about a Wednesday recurrence. Blocking this
    // told the owner to regenerate copy the generator was told to produce.
    const result = lint(
      "Quiz night is back this Wednesday at 7pm. Bring your sharpest team and settle in with a pint.",
      { occurrenceDate: "2026-09-16T19:00:00+01:00" },
      new Date("2026-09-14T09:00:00+01:00"),
    );

    expect(dayIssue(result)).toBeUndefined();
    expect(result.pass).toBe(true);
  });

  it("accepts a mention of the day the post itself goes out", () => {
    const result = lint(
      "Booking for Saturday 19th September? Our lines are open Monday for anyone who wants a table.",
      { eventStart: "2026-09-19T19:00:00+01:00" },
      new Date("2026-09-14T10:00:00+01:00"),
    );

    expect(dayIssue(result)).toBeUndefined();
  });

  it("still reports a day that matches nothing in the brief", () => {
    const result = lint(
      "Our quiz lands on Thursday at 7pm. Bring your sharpest team and settle in with a pint.",
      { eventStart: "2026-09-19T19:00:00+01:00" },
      new Date("2026-09-14T10:00:00+01:00"),
    );

    expect(dayIssue(result)?.message).toContain("thursday");
  });

  it("reports the day mismatch without blocking approval", () => {
    // Advisory: preflight turns a failed lint into a hard block, and a weekday
    // the brief does not list is too often legitimate copy to stop a post.
    const result = lint(
      "Our quiz lands on Thursday at 7pm. Bring your sharpest team and settle in with a pint.",
      { eventStart: "2026-09-19T19:00:00+01:00" },
      new Date("2026-09-14T10:00:00+01:00"),
    );

    expect(dayIssue(result)).toBeDefined();
    expect(result.pass).toBe(true);
  });

  it("says nothing about weekdays when the brief supplies no structured date", () => {
    const result = lint(
      "Live music is back on Saturday with the band taking over the back bar from eight.",
      null,
      new Date("2026-09-15T18:00:00+01:00"),
    );

    expect(dayIssue(result)).toBeUndefined();
  });

  it("still blocks on a genuinely broken body", () => {
    const result = lint(
      "Join us undefined for the quiz.",
      { eventStart: "2026-09-19T19:00:00+01:00" },
      new Date("2026-09-14T10:00:00+01:00"),
    );

    expect(result.pass).toBe(false);
  });
});
