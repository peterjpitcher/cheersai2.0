import { describe, expect, it } from "vitest";

import {
  BANNER_TEXT_PATTERN,
  MAX_BANNER_TEXT_LENGTH,
  normaliseBannerText,
  validateBannerText,
} from "@/lib/banner/text";

describe("normaliseBannerText", () => {
  it("returns null for null, undefined, empty and whitespace-only input", () => {
    expect(normaliseBannerText(null)).toBeNull();
    expect(normaliseBannerText(undefined)).toBeNull();
    expect(normaliseBannerText("")).toBeNull();
    expect(normaliseBannerText("   ")).toBeNull();
  });

  it("trims and uppercases", () => {
    expect(normaliseBannerText("  quiz night  ")).toBe("QUIZ NIGHT");
  });

  it("strips control characters", () => {
    expect(normaliseBannerText("QUIZ\tNIGHT\n")).toBe("QUIZNIGHT");
  });

  it("preserves the pound sign", () => {
    expect(normaliseBannerText("£5 pints")).toBe("£5 PINTS");
  });

  it("caps length at MAX_BANNER_TEXT_LENGTH graphemes", () => {
    const long = "A".repeat(40);
    expect(normaliseBannerText(long)).toHaveLength(MAX_BANNER_TEXT_LENGTH);
  });
});

describe("validateBannerText", () => {
  it("treats blank input as a valid 'no overlay' (null value)", () => {
    expect(validateBannerText("")).toEqual({ ok: true, value: null });
    expect(validateBannerText("   ")).toEqual({ ok: true, value: null });
    expect(validateBannerText(null)).toEqual({ ok: true, value: null });
  });

  it("accepts natural pub pricing with a pound sign end-to-end", () => {
    expect(validateBannerText("£5 pints")).toEqual({ ok: true, value: "£5 PINTS" });
  });

  it("accepts a percentage offer", () => {
    expect(validateBannerText("50% off")).toEqual({ ok: true, value: "50% OFF" });
  });

  it("rejects emoji", () => {
    const result = validateBannerText("QUIZ 🎉");
    expect(result.ok).toBe(false);
  });

  it("caps over-length input rather than rejecting it", () => {
    const result = validateBannerText("A".repeat(40));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(MAX_BANNER_TEXT_LENGTH);
  });
});

describe("BANNER_TEXT_PATTERN", () => {
  it("is a superset of the render endpoint's historical charset (adds £)", () => {
    // Every char class the endpoint previously accepted must still pass, so
    // computed proximity labels never regress.
    expect(BANNER_TEXT_PATTERN.test("THIS FRIDAY")).toBe(true);
    expect(BANNER_TEXT_PATTERN.test("SAT 12 JUL")).toBe(true);
    expect(BANNER_TEXT_PATTERN.test("BUY 1 GET 1 FREE")).toBe(true);
    expect(BANNER_TEXT_PATTERN.test("£5 PINTS")).toBe(true);
    // Still excludes emoji and other currency symbols we did not opt into.
    expect(BANNER_TEXT_PATTERN.test("🎉")).toBe(false);
    expect(BANNER_TEXT_PATTERN.test("€5")).toBe(false);
  });
});
