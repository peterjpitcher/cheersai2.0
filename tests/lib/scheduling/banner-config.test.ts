// tests/lib/scheduling/banner-config.test.ts
import { describe, expect, it } from "vitest";
import {
  BannerConfigSchema,
  BannerDefaultsSchema,
  sanitiseCustomMessage,
  BANNER_COLOUR_HEX,
  DEFAULT_BANNER_CONFIG,
  resolveColours,
  type BannerColourId,
} from "@/lib/scheduling/banner-config";

describe("BannerConfigSchema", () => {
  it("should parse a valid config", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "top",
      bgColour: "gold",
      textColour: "green",
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
      bgColour: "black",
      textColour: "white",
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
      bgColour: "gold",
      textColour: "green",
    };
    const result = BannerConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should reject invalid colour id", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "top",
      bgColour: "red",
      textColour: "blue",
    };
    const result = BannerConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should reject custom message over 20 graphemes", () => {
    const input = {
      schemaVersion: 1,
      enabled: true,
      position: "top",
      bgColour: "gold",
      textColour: "green",
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
    const input = { position: "top", bgColour: "gold", textColour: "green" };
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

describe("BANNER_COLOUR_HEX", () => {
  it("should have hex values for all 4 colour ids", () => {
    const ids: BannerColourId[] = ["gold", "green", "black", "white"];
    for (const id of ids) {
      expect(BANNER_COLOUR_HEX[id]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("resolveColours", () => {
  it("should resolve preset colours", () => {
    const result = resolveColours({ bgColour: "gold", textColour: "green" });
    expect(result.bg).toBe("#a57626");
    expect(result.text).toBe("#005131");
  });
});

describe("DEFAULT_BANNER_CONFIG", () => {
  it("should be valid against schema", () => {
    const result = BannerConfigSchema.safeParse(DEFAULT_BANNER_CONFIG);
    expect(result.success).toBe(true);
  });
});
