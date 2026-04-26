// tests/lib/scheduling/banner-config.test.ts
import { describe, expect, it } from "vitest";
import {
  BannerConfigSchema,
  BannerDefaultsSchema,
  sanitiseCustomMessage,
  COLOUR_MAP,
  DEFAULT_BANNER_CONFIG,
  type BannerColorScheme,
} from "@/lib/scheduling/banner-config";

describe("BannerConfigSchema", () => {
  it("should parse a valid config", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "top",
      colorScheme: "gold-green",
    };
    const result = BannerConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...input, customMessage: undefined });
  });

  it("should parse config with custom message", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "bottom",
      colorScheme: "black-white",
      customMessage: "BOOK NOW",
    };
    const result = BannerConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.customMessage).toBe("BOOK NOW");
  });

  it("should reject invalid position", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "diagonal",
      colorScheme: "gold-green",
    };
    const result = BannerConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should reject invalid colour scheme", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "top",
      colorScheme: "red-blue",
    };
    const result = BannerConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should reject custom message over 20 graphemes", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "top",
      colorScheme: "gold-green",
      customMessage: "THIS IS WAY TOO LONG MESSAGE",
    };
    const result = BannerConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should handle missing/null banner gracefully", () => {
    expect(BannerConfigSchema.safeParse(null).success).toBe(false);
    expect(BannerConfigSchema.safeParse(undefined).success).toBe(false);
    expect(BannerConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe("BannerDefaultsSchema", () => {
  it("should parse valid defaults", () => {
    const input = { position: "top", colorScheme: "gold-green" };
    const result = BannerDefaultsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("sanitiseCustomMessage", () => {
  it("should trim whitespace", () => {
    expect(sanitiseCustomMessage("  HELLO  ")).toBe("HELLO");
  });

  it("should uppercase", () => {
    expect(sanitiseCustomMessage("tonight")).toBe("TONIGHT");
  });

  it("should strip newlines and control chars", () => {
    expect(sanitiseCustomMessage("HELLO\nWORLD")).toBe("HELLOWORLD");
    expect(sanitiseCustomMessage("TEST\t\r")).toBe("TEST");
  });

  it("should return undefined for empty string", () => {
    expect(sanitiseCustomMessage("")).toBeUndefined();
    expect(sanitiseCustomMessage("   ")).toBeUndefined();
  });

  it("should return undefined for null/undefined", () => {
    expect(sanitiseCustomMessage(undefined)).toBeUndefined();
    expect(sanitiseCustomMessage(null as unknown as string)).toBeUndefined();
  });
});

describe("COLOUR_MAP", () => {
  it("should have entries for all 8 schemes", () => {
    const schemes: BannerColorScheme[] = [
      "gold-green", "green-gold",
      "black-white", "black-gold", "black-green",
      "white-black", "white-green", "white-gold",
    ];
    for (const scheme of schemes) {
      expect(COLOUR_MAP[scheme]).toBeDefined();
      expect(COLOUR_MAP[scheme].bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(COLOUR_MAP[scheme].text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("DEFAULT_BANNER_CONFIG", () => {
  it("should be valid against schema", () => {
    const result = BannerConfigSchema.safeParse(DEFAULT_BANNER_CONFIG);
    expect(result.success).toBe(true);
  });
});
