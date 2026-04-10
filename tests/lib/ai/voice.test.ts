import { describe, expect, it } from "vitest";

import { detectBannedPhrases, reduceHype, scrubBannedPhrases } from "@/lib/ai/voice";

describe("scrubBannedPhrases", () => {
  it("replaces 'unforgettable experience' with 'great time'", () => {
    const result = scrubBannedPhrases("unforgettable experience at the pub");
    expect(result.value).toBe("great time at the pub");
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it("replaces 'mouth-watering' with 'delicious'", () => {
    const result = scrubBannedPhrases("mouth-watering burgers");
    expect(result.value).toBe("delicious burgers");
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it("returns string unchanged when no banned phrases present", () => {
    const input = "Join us for a pint tonight.";
    const result = scrubBannedPhrases(input);
    expect(result.value).toBe(input);
    expect(result.removed).toEqual([]);
  });

  it("returns empty string unchanged", () => {
    const result = scrubBannedPhrases("");
    expect(result.value).toBe("");
    expect(result.removed).toEqual([]);
  });

  it("replaces multiple banned phrases in one string", () => {
    const result = scrubBannedPhrases(
      "An unforgettable experience with mouth-watering food and a vibrant atmosphere",
    );
    expect(result.value).not.toContain("unforgettable experience");
    expect(result.value).not.toContain("mouth-watering");
    expect(result.value).not.toContain("vibrant atmosphere");
    expect(result.value).toContain("great time");
    expect(result.value).toContain("delicious");
    expect(result.removed.length).toBeGreaterThanOrEqual(3);
  });
});

describe("reduceHype", () => {
  it("replaces 'the best' with 'a great'", () => {
    const result = reduceHype("the best pub in town");
    expect(result.value).toBe("a great pub in town");
    expect(result.adjusted.length).toBeGreaterThan(0);
  });

  it("replaces 'legendary' with 'classic'", () => {
    const result = reduceHype("legendary fish and chips");
    expect(result.value).toBe("classic fish and chips");
    expect(result.adjusted.length).toBeGreaterThan(0);
  });

  it("returns string unchanged when no hype phrases present", () => {
    const input = "Good food and a warm welcome.";
    const result = reduceHype(input);
    expect(result.value).toBe(input);
    expect(result.adjusted).toEqual([]);
  });
});

describe("detectBannedPhrases", () => {
  it("detects 'vibrant atmosphere' and returns a hit", () => {
    const hits = detectBannedPhrases("Come enjoy the vibrant atmosphere tonight.");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns empty array for clean text", () => {
    const hits = detectBannedPhrases("Pop by for a pint and some good food.");
    expect(hits).toEqual([]);
  });
});
