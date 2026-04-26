// src/lib/scheduling/banner-config.ts
import { z } from "zod";

// --- Types ---

export const BANNER_POSITIONS = ["top", "bottom", "left", "right"] as const;
export type BannerPosition = (typeof BANNER_POSITIONS)[number];

/** The four brand colours available for banner bg and text */
export const BANNER_COLOURS = [
  { id: "gold", hex: "#a57626", label: "Gold" },
  { id: "green", hex: "#005131", label: "Green" },
  { id: "black", hex: "#1a1a1a", label: "Black" },
  { id: "white", hex: "#ffffff", label: "White" },
] as const;

export type BannerColourId = (typeof BANNER_COLOURS)[number]["id"];

export const BANNER_COLOUR_HEX: Record<BannerColourId, string> = {
  gold: "#a57626",
  green: "#005131",
  black: "#1a1a1a",
  white: "#ffffff",
};

export interface BannerConfig {
  schemaVersion: 1;
  enabled: boolean;
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  customMessage?: string;
}

export interface BannerDefaults {
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
}

// --- Resolve hex colours from config ---

export function resolveColours(config: Pick<BannerConfig, "bgColour" | "textColour">): { bg: string; text: string } {
  return {
    bg: BANNER_COLOUR_HEX[config.bgColour] ?? BANNER_COLOUR_HEX.gold,
    text: BANNER_COLOUR_HEX[config.textColour] ?? BANNER_COLOUR_HEX.green,
  };
}

// --- Validation Helpers ---

function graphemeLength(str: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(str)].length;
}

export function sanitiseCustomMessage(
  msg: string | undefined | null
): string | undefined {
  if (msg == null) return undefined;
  const cleaned = msg.replace(/[\n\r\t\x00-\x1f\x7f]/g, "").trim().toUpperCase();
  return cleaned.length === 0 ? undefined : cleaned;
}

// --- Zod Schemas ---

const bannerColourIds = ["gold", "green", "black", "white"] as const;

export const BannerConfigSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  position: z.enum(BANNER_POSITIONS),
  bgColour: z.enum(bannerColourIds),
  textColour: z.enum(bannerColourIds),
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
  bgColour: z.enum(bannerColourIds),
  textColour: z.enum(bannerColourIds),
});

// --- Defaults ---

export const DEFAULT_BANNER_DEFAULTS: BannerDefaults = {
  position: "top",
  bgColour: "gold",
  textColour: "green",
};

export const DEFAULT_BANNER_CONFIG: BannerConfig = {
  schemaVersion: 1,
  enabled: true,
  position: "top",
  bgColour: "gold",
  textColour: "green",
};

/**
 * Safely parse banner config from prompt_context JSONB.
 * Returns null if invalid or missing.
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
    bgColour: d.bgColour,
    textColour: d.textColour,
  };
}

/** Editable statuses — banner config can only be changed on these */
export const BANNER_EDITABLE_STATUSES = ["draft", "scheduled", "queued", "failed"] as const;
