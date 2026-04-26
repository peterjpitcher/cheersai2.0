// src/lib/scheduling/banner-config.ts
import { z } from "zod";

// --- Types ---

export const BANNER_POSITIONS = ["top", "bottom", "left", "right"] as const;
export type BannerPosition = (typeof BANNER_POSITIONS)[number];

export const BANNER_COLOR_SCHEMES = [
  "gold-green", "green-gold",
  "black-white", "black-gold", "black-green",
  "white-black", "white-green", "white-gold",
  "custom",
] as const;
export type BannerColorScheme = (typeof BANNER_COLOR_SCHEMES)[number];

export interface BannerConfig {
  schemaVersion: 1;
  enabled: boolean;
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  customBg?: string;   // hex colour, e.g. "#a57626" — used when colorScheme is "custom"
  customText?: string; // hex colour, e.g. "#005131" — used when colorScheme is "custom"
  customMessage?: string;
}

export interface BannerDefaults {
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  customBg?: string;
  customText?: string;
}

// --- Colour Map ---

export const COLOUR_MAP: Record<Exclude<BannerColorScheme, "custom">, { bg: string; text: string }> = {
  "gold-green":  { bg: "#a57626", text: "#005131" },
  "green-gold":  { bg: "#005131", text: "#a57626" },
  "black-white": { bg: "#1a1a1a", text: "#ffffff" },
  "black-gold":  { bg: "#1a1a1a", text: "#a57626" },
  "black-green": { bg: "#1a1a1a", text: "#005131" },
  "white-black": { bg: "#ffffff", text: "#1a1a1a" },
  "white-green": { bg: "#ffffff", text: "#005131" },
  "white-gold":  { bg: "#ffffff", text: "#a57626" },
};

/**
 * Resolve the actual bg/text colours from a banner config.
 * If colorScheme is "custom", uses customBg/customText.
 * Otherwise looks up the preset from COLOUR_MAP.
 */
export function resolveColours(config: Pick<BannerConfig, "colorScheme" | "customBg" | "customText">): { bg: string; text: string } {
  if (config.colorScheme === "custom") {
    return {
      bg: config.customBg ?? "#a57626",
      text: config.customText ?? "#005131",
    };
  }
  return COLOUR_MAP[config.colorScheme] ?? COLOUR_MAP["gold-green"];
}

// --- Validation Helpers ---

const HEX_COLOUR_REGEX = /^#[0-9a-fA-F]{6}$/;

function graphemeLength(str: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(str)].length;
}

export function sanitiseCustomMessage(
  msg: string | undefined | null
): string | undefined {
  if (msg == null) return undefined;
  // Strip newlines, carriage returns, tabs, and control characters
  const cleaned = msg.replace(/[\n\r\t\x00-\x1f\x7f]/g, "").trim().toUpperCase();
  return cleaned.length === 0 ? undefined : cleaned;
}

// --- Zod Schemas ---

export const BannerConfigSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  position: z.enum(BANNER_POSITIONS),
  colorScheme: z.enum(BANNER_COLOR_SCHEMES),
  customBg: z.string().regex(HEX_COLOUR_REGEX).optional(),
  customText: z.string().regex(HEX_COLOUR_REGEX).optional(),
  customMessage: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (val == null || val.length === 0) return true;
        return graphemeLength(val) <= 20;
      },
      { message: "Custom message must be 20 characters or fewer" }
    ),
});

export const BannerDefaultsSchema = z.object({
  position: z.enum(BANNER_POSITIONS),
  colorScheme: z.enum(BANNER_COLOR_SCHEMES),
  customBg: z.string().regex(HEX_COLOUR_REGEX).optional(),
  customText: z.string().regex(HEX_COLOUR_REGEX).optional(),
});

// --- Defaults ---

export const DEFAULT_BANNER_DEFAULTS: BannerDefaults = {
  position: "top",
  colorScheme: "gold-green",
};

export const DEFAULT_BANNER_CONFIG: BannerConfig = {
  schemaVersion: 1,
  enabled: true,
  position: "top",
  colorScheme: "gold-green",
};

/**
 * Safely parse banner config from prompt_context JSONB.
 * Returns null if invalid or missing — caller should treat as "no banner".
 */
export function parseBannerConfig(raw: unknown): BannerConfig | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const result = BannerConfigSchema.safeParse(obj.banner ?? obj);
  return result.success ? result.data : null;
}

/**
 * Build a BannerConfig from campaign defaults.
 */
export function bannerConfigFromDefaults(defaults?: BannerDefaults): BannerConfig {
  const d = defaults ?? DEFAULT_BANNER_DEFAULTS;
  return {
    schemaVersion: 1,
    enabled: true,
    position: d.position,
    colorScheme: d.colorScheme,
    customBg: d.customBg,
    customText: d.customText,
  };
}

/** Editable statuses — banner config can only be changed on these */
export const BANNER_EDITABLE_STATUSES = ["draft", "scheduled", "queued", "failed"] as const;
