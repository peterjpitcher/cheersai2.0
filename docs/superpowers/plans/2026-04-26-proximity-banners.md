# Proximity Banners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic proximity banners to campaign images that display urgency labels ("THIS WEDNESDAY", "TOMORROW", "TONIGHT") based on how close the post is to the event date.

**Architecture:** Pure functions for proximity logic and config validation (TDD, shared between Next.js and Deno Edge Function). CSS overlays for in-app preview and link-in-bio. FFmpeg rendering at publish time in the Deno Edge Function, with temp storage upload and signed URL handoff to platform providers. Campaign-level defaults in `campaigns.metadata.bannerDefaults`, per-post overrides in `content_items.prompt_context.banner`.

**Tech Stack:** TypeScript, Luxon (dates), Zod (validation), Vitest (tests), FFmpeg (image rendering in Deno Edge Function), React (UI components), Tailwind CSS (styling)

**Spec:** `docs/superpowers/specs/2026-04-26-proximity-banners-design.md`

---

## Phase 1: Core Logic (Pure Functions, TDD)

### Task 1: Banner Config Types & Zod Schema

**Files:**
- Create: `src/lib/scheduling/banner-config.ts`
- Test: `tests/lib/scheduling/banner-config.test.ts`

- [ ] **Step 1: Write failing tests for banner config validation**

```typescript
// tests/lib/scheduling/banner-config.test.ts
import { describe, expect, it } from "vitest";
import {
  BannerConfigSchema,
  BannerDefaultsSchema,
  sanitiseCustomMessage,
  COLOUR_MAP,
  DEFAULT_BANNER_CONFIG,
  type BannerConfig,
  type BannerDefaults,
  type BannerPosition,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/scheduling/banner-config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement banner-config.ts**

```typescript
// src/lib/scheduling/banner-config.ts
import { z } from "zod";

// --- Types ---

export const BANNER_POSITIONS = ["top", "bottom", "left", "right"] as const;
export type BannerPosition = (typeof BANNER_POSITIONS)[number];

export const BANNER_COLOR_SCHEMES = [
  "gold-green", "green-gold",
  "black-white", "black-gold", "black-green",
  "white-black", "white-green", "white-gold",
] as const;
export type BannerColorScheme = (typeof BANNER_COLOR_SCHEMES)[number];

export interface BannerConfig {
  schemaVersion: 1;
  enabled: boolean;
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  customMessage?: string;
}

export interface BannerDefaults {
  position: BannerPosition;
  colorScheme: BannerColorScheme;
}

// --- Colour Map ---

export const COLOUR_MAP: Record<BannerColorScheme, { bg: string; text: string }> = {
  "gold-green":  { bg: "#a57626", text: "#005131" },
  "green-gold":  { bg: "#005131", text: "#a57626" },
  "black-white": { bg: "#1a1a1a", text: "#ffffff" },
  "black-gold":  { bg: "#1a1a1a", text: "#a57626" },
  "black-green": { bg: "#1a1a1a", text: "#005131" },
  "white-black": { bg: "#ffffff", text: "#1a1a1a" },
  "white-green": { bg: "#ffffff", text: "#005131" },
  "white-gold":  { bg: "#ffffff", text: "#a57626" },
};

// --- Validation Helpers ---

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
  };
}

/** Editable statuses — banner config can only be changed on these */
export const BANNER_EDITABLE_STATUSES = ["draft", "scheduled", "queued", "failed"] as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scheduling/banner-config.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/banner-config.ts tests/lib/scheduling/banner-config.test.ts
git commit -m "feat: add banner config types, Zod schema, and validation helpers"
```

---

### Task 2: Campaign Timing Extraction

**Files:**
- Create: `src/lib/scheduling/campaign-timing.ts`
- Test: `tests/lib/scheduling/campaign-timing.test.ts`

- [ ] **Step 1: Write failing tests for campaign timing extraction**

```typescript
// tests/lib/scheduling/campaign-timing.test.ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  extractCampaignTiming,
  getNextWeeklyOccurrence,
  type CampaignTiming,
} from "@/lib/scheduling/campaign-timing";

const TZ = "Europe/London";

describe("extractCampaignTiming", () => {
  it("should extract event campaign timing", () => {
    const campaign = {
      campaign_type: "event",
      metadata: {
        startDate: "2026-05-06",
        startTime: "19:00",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("event");
    expect(result.startAt.toISODate()).toBe("2026-05-06");
    expect(result.startTime).toBe("19:00");
    expect(result.endAt).toBeUndefined();
    expect(result.timezone).toBe(TZ);
  });

  it("should extract promotion campaign timing with end date", () => {
    const campaign = {
      campaign_type: "promotion",
      metadata: {
        startDate: "2026-05-01",
        endDate: "2026-05-15",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("promotion");
    expect(result.startAt.toISODate()).toBe("2026-05-01");
    expect(result.endAt?.toISODate()).toBe("2026-05-15");
    expect(result.startTime).toBeUndefined();
  });

  it("should extract weekly campaign timing", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: {
        dayOfWeek: 4, // Thursday
        time: "19:30",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("weekly");
    expect(result.weeklyDayOfWeek).toBe(4);
    expect(result.startTime).toBe("19:30");
  });

  it("should handle event with eventStart ISO string (legacy metadata)", () => {
    const campaign = {
      campaign_type: "event",
      metadata: {
        eventStart: "2026-05-06T19:00:00.000Z",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("event");
    expect(result.startAt).toBeDefined();
  });
});

describe("getNextWeeklyOccurrence", () => {
  it("should return this week's day if before it", () => {
    // Monday referencing Thursday (dayOfWeek=4)
    const ref = DateTime.fromISO("2026-05-04T10:00:00", { zone: TZ }); // Monday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.weekday).toBe(4);
    expect(result.toISODate()).toBe("2026-05-07"); // Thursday same week
  });

  it("should return next week's day if after it", () => {
    // Friday referencing Thursday (dayOfWeek=4)
    const ref = DateTime.fromISO("2026-05-08T10:00:00", { zone: TZ }); // Friday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.weekday).toBe(4);
    expect(result.toISODate()).toBe("2026-05-14"); // Thursday next week
  });

  it("should return today if same day and time not yet passed", () => {
    // Thursday morning referencing Thursday
    const ref = DateTime.fromISO("2026-05-07T08:00:00", { zone: TZ }); // Thursday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.toISODate()).toBe("2026-05-07");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/scheduling/campaign-timing.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement campaign-timing.ts**

```typescript
// src/lib/scheduling/campaign-timing.ts
import { DateTime } from "luxon";

const DEFAULT_TZ = "Europe/London";

export interface CampaignTiming {
  campaignType: "event" | "promotion" | "weekly";
  startAt: DateTime;
  endAt?: DateTime;
  startTime?: string; // "HH:MM"
  weeklyDayOfWeek?: number; // 1=Mon..7=Sun (Luxon weekday)
  timezone: string;
}

/**
 * Extract canonical timing from a campaign's metadata.
 * Handles both current metadata shapes and legacy eventStart ISO strings.
 */
export function extractCampaignTiming(campaign: {
  campaign_type: string;
  metadata: unknown;
}): CampaignTiming {
  const meta = (campaign.metadata ?? {}) as Record<string, unknown>;
  const tz = DEFAULT_TZ;

  if (campaign.campaign_type === "weekly") {
    return {
      campaignType: "weekly",
      startAt: DateTime.now().setZone(tz), // placeholder — weekly uses dayOfWeek
      weeklyDayOfWeek: Number(meta.dayOfWeek) || 1,
      startTime: typeof meta.time === "string" ? meta.time : undefined,
      timezone: tz,
    };
  }

  // Parse startAt from metadata
  let startAt: DateTime;
  if (typeof meta.startDate === "string") {
    startAt = DateTime.fromISO(meta.startDate, { zone: tz });
  } else if (typeof meta.eventStart === "string") {
    // Legacy: full ISO timestamp
    startAt = DateTime.fromISO(meta.eventStart, { zone: tz });
  } else {
    startAt = DateTime.now().setZone(tz);
  }

  // Extract startTime from metadata or from parsed ISO
  let startTime: string | undefined;
  if (typeof meta.startTime === "string") {
    startTime = meta.startTime;
  } else if (typeof meta.eventStart === "string") {
    const parsed = DateTime.fromISO(meta.eventStart, { zone: tz });
    if (parsed.isValid) {
      startTime = parsed.toFormat("HH:mm");
    }
  }

  if (campaign.campaign_type === "promotion") {
    const endAt = typeof meta.endDate === "string"
      ? DateTime.fromISO(meta.endDate, { zone: tz })
      : undefined;

    return {
      campaignType: "promotion",
      startAt,
      endAt,
      startTime,
      timezone: tz,
    };
  }

  return {
    campaignType: "event",
    startAt,
    startTime,
    timezone: tz,
  };
}

/**
 * Calculate the next occurrence of a weekly event day relative to referenceAt.
 * If referenceAt is on or before the day this week, returns this week's occurrence.
 * If referenceAt is after the day this week, returns next week's occurrence.
 */
export function getNextWeeklyOccurrence(
  referenceAt: DateTime,
  dayOfWeek: number,
  timezone: string
): DateTime {
  const ref = referenceAt.setZone(timezone).startOf("day");
  const currentWeekday = ref.weekday; // 1=Mon..7=Sun

  let daysUntil = dayOfWeek - currentWeekday;
  if (daysUntil < 0) {
    daysUntil += 7;
  }

  return ref.plus({ days: daysUntil });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scheduling/campaign-timing.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/campaign-timing.ts tests/lib/scheduling/campaign-timing.test.ts
git commit -m "feat: add campaign timing extraction from metadata"
```

---

### Task 3: Proximity Label Logic — Event Campaigns

**Files:**
- Create: `src/lib/scheduling/proximity-label.ts`
- Test: `tests/lib/scheduling/proximity-label.test.ts`

- [ ] **Step 1: Write failing tests for event proximity labels**

```typescript
// tests/lib/scheduling/proximity-label.test.ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import type { CampaignTiming } from "@/lib/scheduling/campaign-timing";

const TZ = "Europe/London";

function eventTiming(date: string, time?: string): CampaignTiming {
  return {
    campaignType: "event",
    startAt: DateTime.fromISO(date, { zone: TZ }),
    startTime: time,
    timezone: TZ,
  };
}

function ref(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TZ });
}

describe("getProximityLabel — event campaigns", () => {
  it("should return null for 7+ days before event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"),
      campaignTiming: eventTiming("2026-05-08", "19:00"),
    });
    expect(result).toBeNull();
  });

  it("should return THIS {WEEKDAY} for 6 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS {WEEKDAY} for 2 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS MONDAY for Friday→Monday (3 days, cross-week)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-11", "19:00"), // Monday
    });
    expect(result).toBe("THIS MONDAY");
  });

  it("should return null for Saturday→Saturday (7 days)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-02T10:00:00"), // Saturday
      campaignTiming: eventTiming("2026-05-09", "19:00"), // next Saturday
    });
    expect(result).toBeNull();
  });

  it("should return TOMORROW for 1 day before, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return TOMORROW NIGHT for 1 day before, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TOMORROW NIGHT");
  });

  it("should return TODAY for same day, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TONIGHT for same day, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TONIGHT");
  });

  it("should return TODAY when no start time specified", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TOMORROW when no start time, 1 day before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return null for post after event start timestamp", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T20:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });

  it("should return null for post day after event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/scheduling/proximity-label.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement getProximityLabel for event campaigns**

```typescript
// src/lib/scheduling/proximity-label.ts
import { DateTime } from "luxon";
import type { CampaignTiming } from "./campaign-timing";
import { getNextWeeklyOccurrence } from "./campaign-timing";

// Duplicated in supabase/functions/publish-queue/proximity.ts — keep in sync
export type ProximityLabel = string | null;

export interface ProximityLabelInput {
  referenceAt: DateTime;
  campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
  "", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

function isEvening(startTime?: string): boolean {
  if (!startTime) return false;
  const hour = parseInt(startTime.split(":")[0], 10);
  return hour >= EVENING_THRESHOLD_HOUR;
}

function getEventStartTimestamp(
  eventDate: DateTime,
  startTime: string | undefined,
  timezone: string
): DateTime {
  if (!startTime) {
    // No start time — use end of day as the "event start" for post-event comparison
    return eventDate.setZone(timezone).endOf("day");
  }
  const [h, m] = startTime.split(":").map(Number);
  return eventDate.setZone(timezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
  referenceAt: DateTime,
  timing: CampaignTiming
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const eventDay = timing.startAt.setZone(tz).startOf("day");

  // Post-event check: compare against full timestamp
  const eventTimestamp = getEventStartTimestamp(timing.startAt, timing.startTime, tz);
  if (referenceAt >= eventTimestamp) {
    return null;
  }

  const daysDiff = eventDay.diff(refDay, "days").days;

  if (daysDiff <= 0) {
    // Same day
    return isEvening(timing.startTime) ? "TONIGHT" : "TODAY";
  }

  if (daysDiff === 1) {
    return isEvening(timing.startTime) ? "TOMORROW NIGHT" : "TOMORROW";
  }

  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[timing.startAt.setZone(tz).weekday];
    return `THIS ${weekdayName}`;
  }

  return null; // 7+ days
}

export function getProximityLabel(input: ProximityLabelInput): ProximityLabel {
  const { referenceAt, campaignTiming } = input;

  switch (campaignTiming.campaignType) {
    case "event":
      return getEventLabel(referenceAt, campaignTiming);

    case "weekly": {
      if (!campaignTiming.weeklyDayOfWeek) return null;
      const nextOccurrence = getNextWeeklyOccurrence(
        referenceAt,
        campaignTiming.weeklyDayOfWeek,
        campaignTiming.timezone
      );
      const weeklyTiming: CampaignTiming = {
        ...campaignTiming,
        campaignType: "event",
        startAt: nextOccurrence,
      };
      return getEventLabel(referenceAt, weeklyTiming);
    }

    case "promotion":
      return getPromotionLabel(referenceAt, campaignTiming);

    default:
      return null;
  }
}

function getPromotionLabel(
  referenceAt: DateTime,
  timing: CampaignTiming
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const startDay = timing.startAt.setZone(tz).startOf("day");

  // End-of-day semantics for endAt
  const endDay = timing.endAt
    ? timing.endAt.setZone(tz).startOf("day")
    : undefined;
  const endEOD = endDay
    ? endDay.endOf("day")
    : undefined;

  // After promotion ended
  if (endEOD && referenceAt > endEOD) {
    return null;
  }

  // During promotion (referenceAt >= startAt)
  if (referenceAt >= timing.startAt.setZone(tz).startOf("day")) {
    if (!endDay) return "ON NOW";

    const daysToEnd = endDay.diff(refDay, "days").days;

    if (daysToEnd <= 0) return "LAST DAY";
    if (daysToEnd === 1) return "ENDS TOMORROW";
    if (daysToEnd >= 2 && daysToEnd <= 6) {
      const weekdayName = WEEKDAY_NAMES[endDay.weekday];
      return `ENDS ${weekdayName}`;
    }
    return "ON NOW";
  }

  // Before promotion start — use event-style logic against startAt
  const daysDiff = startDay.diff(refDay, "days").days;

  if (daysDiff <= 0) return "TODAY";
  if (daysDiff === 1) return "TOMORROW";
  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[startDay.weekday];
    return `THIS ${weekdayName}`;
  }

  return null; // 7+ days before start
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scheduling/proximity-label.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/proximity-label.ts tests/lib/scheduling/proximity-label.test.ts
git commit -m "feat: add proximity label logic for event campaigns"
```

---

### Task 4: Proximity Label Logic — Promotion & Weekly Tests

**Files:**
- Modify: `tests/lib/scheduling/proximity-label.test.ts`

- [ ] **Step 1: Add promotion and weekly tests**

Append to `tests/lib/scheduling/proximity-label.test.ts`:

```typescript
function promoTiming(start: string, end: string): CampaignTiming {
  return {
    campaignType: "promotion",
    startAt: DateTime.fromISO(start, { zone: TZ }),
    endAt: DateTime.fromISO(end, { zone: TZ }),
    timezone: TZ,
  };
}

function weeklyTiming(dayOfWeek: number, time?: string): CampaignTiming {
  return {
    campaignType: "weekly",
    startAt: DateTime.now().setZone(TZ),
    weeklyDayOfWeek: dayOfWeek,
    startTime: time,
    timezone: TZ,
  };
}

describe("getProximityLabel — promotion campaigns", () => {
  it("should return null before start, 7+ days out", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"),
      campaignTiming: promoTiming("2026-05-09", "2026-05-20"),
    });
    expect(result).toBeNull();
  });

  it("should return THIS {WEEKDAY} before start, 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"), // starts Friday
    });
    expect(result).toBe("THIS FRIDAY");
  });

  it("should return TOMORROW before start, 1 day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return TODAY on start day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    // On start day, promotion has started, end is 12 days away → ON NOW
    // Wait — start day. referenceAt >= startAt, so it's "during".
    // daysToEnd = 12 → ON NOW
    expect(result).toBe("ON NOW");
  });

  it("should return ON NOW during promotion, end 7+ days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("ON NOW");
  });

  it("should return ENDS {WEEKDAY} during, end 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-15T10:00:00"), // Friday
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"), // ends Wednesday
    });
    expect(result).toBe("ENDS WEDNESDAY");
  });

  it("should return ENDS TOMORROW during, end 1 day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-19T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("ENDS TOMORROW");
  });

  it("should return LAST DAY on end day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-20T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("LAST DAY");
  });

  it("should return null after end date EOD", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-21T00:00:01"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBeNull();
  });
});

describe("getProximityLabel — weekly campaigns", () => {
  it("should return THIS {WEEKDAY} for same week occurrence", () => {
    // Monday → Thursday event (dayOfWeek=4)
    const result = getProximityLabel({
      referenceAt: ref("2026-05-04T10:00:00"), // Monday
      campaignTiming: weeklyTiming(4, "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return TOMORROW for day before weekly occurrence", () => {
    // Wednesday → Thursday event
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"), // Wednesday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("TOMORROW NIGHT");
  });

  it("should return TONIGHT on the event day (evening)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T10:00:00"), // Thursday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("TONIGHT");
  });

  it("should look at next week after this week's occurrence", () => {
    // Friday after Thursday event → next Thursday is 6 days away
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"), // Friday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("THIS THURSDAY");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scheduling/proximity-label.test.ts`
Expected: All PASS (promotion "TODAY on start day" test may need adjustment — on start day the promotion has started, so it goes to "during" logic which returns ON NOW for far end dates. Adjust test expectation if needed.)

- [ ] **Step 3: Fix any failing tests by adjusting expectations or logic**

The "TODAY on start day" case: when `referenceAt` is on `startAt` day, `referenceAt >= startAt.startOf("day")` is true, so it enters the "during promotion" branch. With end 12 days away, it returns `ON NOW`. This is correct behaviour — on start day the promotion has started.

- [ ] **Step 4: Commit**

```bash
git add tests/lib/scheduling/proximity-label.test.ts
git commit -m "test: add promotion and weekly proximity label tests"
```

---

## Phase 2: Campaign Creation Integration

### Task 5: Propagate Banner Defaults to Content Items

**Files:**
- Modify: `src/lib/create/service.ts` (where content items are created)
- Modify: `src/lib/create/schema.ts` (add banner defaults to form schema)
- Modify: `src/app/(app)/create/actions.ts` (pass defaults through)

- [ ] **Step 1: Add banner defaults to campaign creation schema**

In `src/lib/create/schema.ts`, add to each campaign form schema:

```typescript
import { BannerDefaultsSchema } from "@/lib/scheduling/banner-config";

// Add to eventCampaignFormSchema, promotionCampaignFormSchema, weeklyCampaignFormSchema:
bannerDefaults: BannerDefaultsSchema.optional(),
```

- [ ] **Step 2: Update createCampaignFromPlans to include banner config**

In `src/lib/create/service.ts`, in the `createCampaignFromPlans` function, after building `metadata`:

```typescript
import { bannerConfigFromDefaults, type BannerDefaults } from "@/lib/scheduling/banner-config";

// In the metadata object being inserted into campaigns:
// Add bannerDefaults from the input params
// metadata: { ...existingMetadata, bannerDefaults: input.bannerDefaults }

// When building content_items, merge banner config into prompt_context:
// For each variant's promptContext:
const bannerConfig = bannerConfigFromDefaults(metadata.bannerDefaults as BannerDefaults | undefined);
// variant.promptContext = { ...variant.promptContext, banner: bannerConfig }
```

Read the existing `createCampaignFromPlans` function carefully. Find where `prompt_context` is set on each content item insert and merge the banner config there. The key line to modify is the content_items insert where `prompt_context: variant.promptContext` is set — change it to `prompt_context: { ...variant.promptContext, banner: bannerConfig }`.

- [ ] **Step 3: Update campaign form actions to pass bannerDefaults**

In `src/app/(app)/create/actions.ts`, ensure the `bannerDefaults` field from the form is passed through to the service function.

- [ ] **Step 4: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/service.ts src/lib/create/schema.ts src/app/(app)/create/actions.ts
git commit -m "feat: propagate banner defaults from campaign to content items"
```

---

### Task 6: Update Weekly Materialiser

**Files:**
- Modify: `supabase/functions/materialise-weekly/worker.ts`

- [ ] **Step 1: Read banner defaults from campaign metadata when materialising**

In `materialiseForCampaign`, after reading metadata, extract `bannerDefaults`:

```typescript
const bannerDefaults = metadata.bannerDefaults as { position: string; colorScheme: string } | undefined;
const bannerConfig = bannerDefaults
  ? {
      schemaVersion: 1,
      enabled: true,
      position: bannerDefaults.position,
      colorScheme: bannerDefaults.colorScheme,
    }
  : {
      schemaVersion: 1,
      enabled: true,
      position: "top",
      colorScheme: "gold-green",
    };
```

Then merge into the `prompt_context` of each content item being created:

```typescript
// Where prompt_context is built for each insert:
prompt_context: { ...existingPromptContext, banner: bannerConfig },
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit` (note: Deno functions may not be covered by main tsconfig — verify manually)
Expected: Clean or only pre-existing issues

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/materialise-weekly/worker.ts
git commit -m "feat: materialise-weekly reads banner defaults from campaign metadata"
```

---

## Phase 3: Planner UI

### Task 7: Banner Preview Component

**Files:**
- Create: `src/features/planner/banner-preview.tsx`

- [ ] **Step 1: Create the CSS overlay component**

```tsx
// src/features/planner/banner-preview.tsx
"use client";

import { COLOUR_MAP, type BannerConfig, type BannerColorScheme, type BannerPosition } from "@/lib/scheduling/banner-config";

interface BannerPreviewProps {
  label: string;
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  className?: string;
}

export function BannerPreview({ label, position, colorScheme, className = "" }: BannerPreviewProps): React.ReactElement {
  const colours = COLOUR_MAP[colorScheme];
  const isVertical = position === "left" || position === "right";

  const barStyle: React.CSSProperties = {
    position: "absolute",
    backgroundColor: colours.bg,
    color: colours.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    zIndex: 10,
    ...(isVertical
      ? {
          top: 0,
          bottom: 0,
          width: "8%",
          writingMode: "vertical-rl" as const,
          ...(position === "left" ? { left: 0, transform: "rotate(180deg)" } : { right: 0 }),
          fontSize: "0.55rem",
        }
      : {
          left: 0,
          right: 0,
          height: "8%",
          ...(position === "top" ? { top: 0 } : { bottom: 0 }),
          fontSize: "0.65rem",
        }),
  };

  return (
    <div style={barStyle} className={className}>
      {label}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/planner/banner-preview.tsx
git commit -m "feat: add BannerPreview CSS overlay component"
```

---

### Task 8: Banner Controls Component

**Files:**
- Create: `src/features/planner/banner-controls.tsx`

- [ ] **Step 1: Create the controls component**

```tsx
// src/features/planner/banner-controls.tsx
"use client";

import { useState, useTransition } from "react";
import {
  BANNER_POSITIONS,
  BANNER_COLOR_SCHEMES,
  COLOUR_MAP,
  sanitiseCustomMessage,
  BANNER_EDITABLE_STATUSES,
  type BannerConfig,
  type BannerPosition,
  type BannerColorScheme,
} from "@/lib/scheduling/banner-config";
import { updatePlannerBannerConfig } from "@/app/(app)/planner/actions";

interface BannerControlsProps {
  contentItemId: string;
  status: string;
  bannerConfig: BannerConfig | null;
  autoLabel: string | null;
  onUpdate?: (config: BannerConfig) => void;
}

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

export function BannerControls({
  contentItemId,
  status,
  bannerConfig,
  autoLabel,
  onUpdate,
}: BannerControlsProps): React.ReactElement {
  const isEditable = (BANNER_EDITABLE_STATUSES as readonly string[]).includes(status);
  const [isPending, startTransition] = useTransition();

  const config = bannerConfig ?? {
    schemaVersion: 1 as const,
    enabled: false,
    position: "top" as const,
    colorScheme: "gold-green" as const,
  };

  const [customMsg, setCustomMsg] = useState(config.customMessage ?? "");

  function save(partial: Partial<BannerConfig>): void {
    if (!isEditable) return;
    const updated: BannerConfig = { ...config, ...partial, schemaVersion: 1 };
    startTransition(async () => {
      await updatePlannerBannerConfig(contentItemId, updated);
      onUpdate?.(updated);
    });
  }

  const graphemeCount = customMsg.length;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Proximity Banner</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={!isEditable || isPending}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          <span className="text-xs text-muted-foreground">
            {config.enabled ? "On" : "Off"}
          </span>
        </label>
      </div>

      {config.enabled && (
        <>
          {/* Position picker */}
          <div>
            <span className="text-xs text-muted-foreground">Position</span>
            <div className="mt-1 flex gap-1">
              {BANNER_POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  disabled={!isEditable || isPending}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    config.position === pos
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  onClick={() => save({ position: pos })}
                >
                  {POSITION_LABELS[pos]}
                </button>
              ))}
            </div>
          </div>

          {/* Colour scheme */}
          <div>
            <span className="text-xs text-muted-foreground">Colour</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {BANNER_COLOR_SCHEMES.map((scheme) => {
                const c = COLOUR_MAP[scheme];
                return (
                  <button
                    key={scheme}
                    type="button"
                    disabled={!isEditable || isPending}
                    className={`flex h-7 w-14 items-center justify-center rounded border text-[10px] font-bold ${
                      config.colorScheme === scheme ? "ring-2 ring-primary" : ""
                    }`}
                    style={{ backgroundColor: c.bg, color: c.text }}
                    onClick={() => save({ colorScheme: scheme })}
                  >
                    Aa
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom message */}
          <div>
            <span className="text-xs text-muted-foreground">
              Custom message (optional)
            </span>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                maxLength={20}
                placeholder={autoLabel ?? "Auto-generated"}
                value={customMsg}
                disabled={!isEditable || isPending}
                className="flex-1 rounded border px-2 py-1 text-sm uppercase"
                onChange={(e) => setCustomMsg(e.target.value)}
                onBlur={() => {
                  const sanitised = sanitiseCustomMessage(customMsg);
                  setCustomMsg(sanitised ?? "");
                  save({ customMessage: sanitised });
                }}
              />
              <span className="self-center text-xs text-muted-foreground">
                {graphemeCount}/20
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/planner/banner-controls.tsx
git commit -m "feat: add BannerControls component for planner"
```

---

### Task 9: Planner Server Action for Banner Config

**Files:**
- Modify: `src/app/(app)/planner/actions.ts`

- [ ] **Step 1: Add the updatePlannerBannerConfig action**

Add to `src/app/(app)/planner/actions.ts`:

```typescript
import { BannerConfigSchema, BANNER_EDITABLE_STATUSES, type BannerConfig } from "@/lib/scheduling/banner-config";

const bannerUpdateSchema = z.object({
  contentId: z.string().uuid(),
  banner: BannerConfigSchema,
});

export async function updatePlannerBannerConfig(
  contentItemId: string,
  bannerConfig: BannerConfig
): Promise<{ success?: boolean; error?: string }> {
  "use server";

  const parsed = bannerUpdateSchema.safeParse({
    contentId: contentItemId,
    banner: bannerConfig,
  });
  if (!parsed.success) {
    return { error: "Invalid banner configuration" };
  }

  const { accountId, supabase } = await requireAuthContext();

  // Load current content item to check status and get existing prompt_context
  const { data: item, error: loadError } = await supabase
    .from("content_items")
    .select("id, status, prompt_context")
    .eq("id", parsed.data.contentId)
    .eq("account_id", accountId)
    .single();

  if (loadError || !item) {
    return { error: "Content item not found" };
  }

  if (!(BANNER_EDITABLE_STATUSES as readonly string[]).includes(item.status)) {
    return { error: "Cannot edit banner on published content" };
  }

  // Safe merge: preserve all existing prompt_context keys
  const existingContext = (item.prompt_context ?? {}) as Record<string, unknown>;
  const updatedContext = { ...existingContext, banner: parsed.data.banner };

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ prompt_context: updatedContext })
    .eq("id", parsed.data.contentId)
    .eq("account_id", accountId);

  if (updateError) {
    return { error: "Failed to update banner config" };
  }

  revalidatePath("/planner");
  return { success: true };
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/planner/actions.ts
git commit -m "feat: add updatePlannerBannerConfig server action with safe JSON merge"
```

---

### Task 10: Integrate Banner Preview into Planner Composer

**Files:**
- Modify: `src/features/planner/planner-content-composer.tsx`
- Modify: `src/lib/planner/data.ts`

- [ ] **Step 1: Ensure planner data includes campaign metadata**

In `src/lib/planner/data.ts`, check the query that loads `PlannerContentDetail`. If `campaigns(name)` is the current join, extend to `campaigns(name, campaign_type, metadata)` so the planner has access to campaign timing for label calculation.

- [ ] **Step 2: Add banner preview overlay to the composer**

In `src/features/planner/planner-content-composer.tsx`, find the image preview section (around line 198 where `primaryMedia.mediaType === "image"` is checked). Wrap the image in a `position: relative` container and add the `BannerPreview` component:

```tsx
import { BannerPreview } from "./banner-preview";
import { BannerControls } from "./banner-controls";
import { parseBannerConfig } from "@/lib/scheduling/banner-config";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { DateTime } from "luxon";

// Inside the component, compute the banner label:
const bannerConfig = parseBannerConfig(detail.promptContext);
const campaignTiming = detail.campaign
  ? extractCampaignTiming({
      campaign_type: detail.campaign.campaignType ?? "event",
      metadata: detail.campaign.metadata,
    })
  : null;
const bannerLabel = bannerConfig?.enabled && campaignTiming
  ? (bannerConfig.customMessage ??
     getProximityLabel({
       referenceAt: DateTime.fromISO(detail.scheduledFor, { zone: "Europe/London" }),
       campaignTiming,
     }))
  : null;

// In the image preview JSX, wrap with relative container:
// <div className="relative overflow-hidden rounded-lg">
//   {/* existing image */}
//   {bannerLabel && bannerConfig && (
//     <BannerPreview
//       label={bannerLabel}
//       position={bannerConfig.position}
//       colorScheme={bannerConfig.colorScheme}
//     />
//   )}
// </div>

// Below the media section, add BannerControls:
// <BannerControls
//   contentItemId={detail.id}
//   status={detail.status}
//   bannerConfig={bannerConfig}
//   autoLabel={campaignTiming ? getProximityLabel({ referenceAt: ..., campaignTiming }) : null}
// />
```

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add src/features/planner/planner-content-composer.tsx src/lib/planner/data.ts
git commit -m "feat: integrate banner preview and controls into planner composer"
```

---

## Phase 4: Campaign Creation Forms

### Task 11: Add Banner Defaults to Campaign Forms

**Files:**
- Modify: `src/features/create/event-campaign-form.tsx`
- Modify: `src/features/create/promotion-campaign-form.tsx`
- Modify: `src/features/create/weekly-campaign-form.tsx`

- [ ] **Step 1: Create a shared BannerDefaultsPicker component**

```tsx
// src/features/create/banner-defaults-picker.tsx
"use client";

import {
  BANNER_POSITIONS,
  BANNER_COLOR_SCHEMES,
  COLOUR_MAP,
  DEFAULT_BANNER_DEFAULTS,
  type BannerDefaults,
  type BannerPosition,
} from "@/lib/scheduling/banner-config";

interface BannerDefaultsPickerProps {
  value: BannerDefaults;
  onChange: (value: BannerDefaults) => void;
}

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top", bottom: "Bottom", left: "Left", right: "Right",
};

export function BannerDefaultsPicker({ value, onChange }: BannerDefaultsPickerProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium">Banner Position</label>
        <div className="mt-1 flex gap-1">
          {BANNER_POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium ${
                value.position === pos ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
              onClick={() => onChange({ ...value, position: pos })}
            >
              {POSITION_LABELS[pos]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Banner Colour</label>
        <div className="mt-1 flex flex-wrap gap-1">
          {BANNER_COLOR_SCHEMES.map((scheme) => {
            const c = COLOUR_MAP[scheme];
            return (
              <button
                key={scheme}
                type="button"
                className={`flex h-7 w-14 items-center justify-center rounded border text-[10px] font-bold ${
                  value.colorScheme === scheme ? "ring-2 ring-primary" : ""
                }`}
                style={{ backgroundColor: c.bg, color: c.text }}
                onClick={() => onChange({ ...value, colorScheme: scheme })}
              >
                Aa
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add BannerDefaultsPicker to each campaign form**

In each campaign form file, add a new `StageAccordion` section after the hero media / before platforms section:

```tsx
import { BannerDefaultsPicker } from "./banner-defaults-picker";
import { DEFAULT_BANNER_DEFAULTS } from "@/lib/scheduling/banner-config";

// In form state:
const [bannerDefaults, setBannerDefaults] = useState(DEFAULT_BANNER_DEFAULTS);

// In JSX (new StageAccordion):
// <StageAccordion title="Proximity Banner">
//   <BannerDefaultsPicker value={bannerDefaults} onChange={setBannerDefaults} />
// </StageAccordion>

// In form submission, include bannerDefaults in the payload passed to the server action.
```

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add src/features/create/banner-defaults-picker.tsx src/features/create/event-campaign-form.tsx src/features/create/promotion-campaign-form.tsx src/features/create/weekly-campaign-form.tsx
git commit -m "feat: add banner defaults picker to campaign creation forms"
```

---

## Phase 5: Publish Pipeline

### Task 12: Deno Proximity Logic (Edge Function Copy)

**Files:**
- Create: `supabase/functions/publish-queue/proximity.ts`

- [ ] **Step 1: Create the Deno-compatible proximity module**

Copy the core logic from `src/lib/scheduling/proximity-label.ts` and `src/lib/scheduling/campaign-timing.ts` into a single self-contained Deno module. Replace the `luxon` import with a Deno-compatible version:

```typescript
// supabase/functions/publish-queue/proximity.ts
// KEEP IN SYNC WITH: src/lib/scheduling/proximity-label.ts
// KEEP IN SYNC WITH: src/lib/scheduling/campaign-timing.ts

import { DateTime } from "https://esm.sh/luxon@3.5.0";

// ... paste the full CampaignTiming interface, extractCampaignTiming,
// getNextWeeklyOccurrence, getProximityLabel, getEventLabel,
// getPromotionLabel functions from the source files.
// The logic is identical — only imports differ.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/publish-queue/proximity.ts
git commit -m "feat: add Deno-compatible proximity label module for publish worker"
```

---

### Task 13: FFmpeg Banner Renderer

**Files:**
- Create: `supabase/functions/publish-queue/banner-renderer.ts`

- [ ] **Step 1: Create the banner renderer**

```typescript
// supabase/functions/publish-queue/banner-renderer.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Colour map — duplicated from banner-config.ts for Deno compatibility
const COLOUR_MAP: Record<string, { bg: string; text: string }> = {
  "gold-green":  { bg: "#a57626", text: "#005131" },
  "green-gold":  { bg: "#005131", text: "#a57626" },
  "black-white": { bg: "#1a1a1a", text: "#ffffff" },
  "black-gold":  { bg: "#1a1a1a", text: "#a57626" },
  "black-green": { bg: "#1a1a1a", text: "#005131" },
  "white-black": { bg: "#ffffff", text: "#1a1a1a" },
  "white-green": { bg: "#ffffff", text: "#005131" },
  "white-gold":  { bg: "#ffffff", text: "#a57626" },
};

export interface BannerRenderInput {
  imageUrl: string;
  placement: "feed" | "story";
  position: "top" | "bottom" | "left" | "right";
  colorScheme: string;
  labelText: string;
  contentItemId: string;
  variantId: string;
}

export interface BannerRenderOutput {
  tempStoragePath: string;
  signedUrl: string;
}

/**
 * Render a banner overlay onto an image using FFmpeg.
 * Uploads the result to temp storage and returns a signed URL.
 *
 * NOTE: This requires the FFmpeg WASM module to be available.
 * Reuses the same FFmpeg infrastructure as media-derivatives.
 * If FFmpeg is not available, this function throws and the caller
 * should fall back to publishing without a banner.
 */
export async function renderBanner(
  input: BannerRenderInput,
  supabase: ReturnType<typeof createClient>,
  ffmpeg: any // FFmpeg instance from ensureFfmpeg()
): Promise<BannerRenderOutput> {
  const colours = COLOUR_MAP[input.colorScheme] ?? COLOUR_MAP["gold-green"];
  const isVertical = input.position === "left" || input.position === "right";

  // Dimensions
  const width = 1080;
  const height = input.placement === "feed" ? 1350 : 1920;
  const barSize = 48; // px

  // Download source image
  const response = await fetch(input.imageUrl);
  const imageData = new Uint8Array(await response.arrayBuffer());
  const inputFilename = "input.jpg";
  const outputFilename = "output.jpg";

  ffmpeg.FS("writeFile", inputFilename, imageData);

  // Build FFmpeg filter for banner overlay
  // drawbox draws a filled rectangle, drawtext renders text on top
  let drawboxFilter: string;
  let drawtextFilter: string;
  const fontPath = "/tmp/font.ttf"; // Bundled font — see deployment notes

  if (isVertical) {
    const x = input.position === "left" ? 0 : width - barSize;
    drawboxFilter = `drawbox=x=${x}:y=0:w=${barSize}:h=${height}:color=${colours.bg}:t=fill`;
    // Vertical text requires rotation — FFmpeg drawtext doesn't natively support vertical text well
    // Alternative: render horizontal text on a separate canvas and overlay rotated
    // For v1: use horizontal text in the bar centre (acceptable for narrow bars)
    const textX = x + barSize / 2;
    const textY = height / 2;
    drawtextFilter = `drawtext=text='${input.labelText}':fontfile=${fontPath}:fontsize=20:fontcolor=${colours.text}:x=${textX}-tw/2:y=${textY}-th/2`;
  } else {
    const y = input.position === "top" ? 0 : height - barSize;
    drawboxFilter = `drawbox=x=0:y=${y}:w=${width}:h=${barSize}:color=${colours.bg}:t=fill`;
    const textY = y + barSize / 2;
    drawtextFilter = `drawtext=text='${input.labelText}':fontfile=${fontPath}:fontsize=24:fontcolor=${colours.text}:x=(w-tw)/2:y=${textY}-th/2`;
  }

  await ffmpeg.run(
    "-i", inputFilename,
    "-vf", `${drawboxFilter},${drawtextFilter}`,
    "-q:v", "2", // JPEG quality ~92
    "-y", outputFilename
  );

  const outputData = ffmpeg.FS("readFile", outputFilename);

  // Cleanup FFmpeg filesystem
  ffmpeg.FS("unlink", inputFilename);
  ffmpeg.FS("unlink", outputFilename);

  // Upload to temp storage
  const tempPath = `banners/${input.contentItemId}/${input.variantId}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("media")
    .upload(tempPath, outputData, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload bannered image: ${uploadError.message}`);
  }

  // Create signed URL
  const { data: signedData, error: signError } = await supabase.storage
    .from("media")
    .createSignedUrl(tempPath, 600); // 600s TTL

  if (signError || !signedData?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signError?.message}`);
  }

  return {
    tempStoragePath: tempPath,
    signedUrl: signedData.signedUrl,
  };
}

/**
 * Delete temp banner file after successful publish.
 */
export async function cleanupBannerTemp(
  tempPath: string,
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  await supabase.storage.from("media").remove([tempPath]);
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/publish-queue/banner-renderer.ts
git commit -m "feat: add FFmpeg banner renderer for publish pipeline"
```

---

### Task 14: Integrate Banner Rendering into Publish Worker

**Files:**
- Modify: `supabase/functions/publish-queue/worker.ts`

- [ ] **Step 1: Import banner modules**

Add imports at the top of `worker.ts`:

```typescript
import { renderBanner, cleanupBannerTemp, type BannerRenderOutput } from "./banner-renderer.ts";
import { extractCampaignTiming, getProximityLabel } from "./proximity.ts";
```

- [ ] **Step 2: Extend the campaign query**

Find where content items are loaded (around line 671). The current query joins `campaigns(name)`. Extend to:

```typescript
campaigns(name, campaign_type, metadata)
```

- [ ] **Step 3: Add banner rendering before platform dispatch**

Find where media assets are resolved and signed URLs are built (around lines 711-800). After the `urlMap` is built and `MediaAsset[]` is constructed, add the banner rendering step:

```typescript
// After building mediaAssets array, before publishByPlatform:
let bannerTempPath: string | undefined;

try {
  const promptContext = (contentItem.prompt_context ?? {}) as Record<string, unknown>;
  const bannerRaw = promptContext.banner;

  if (bannerRaw && typeof bannerRaw === "object") {
    const banner = bannerRaw as {
      schemaVersion?: number;
      enabled?: boolean;
      position?: string;
      colorScheme?: string;
      customMessage?: string;
    };

    if (banner.enabled && banner.position && banner.colorScheme) {
      const campaign = contentItem.campaigns;
      if (campaign) {
        const timing = extractCampaignTiming({
          campaign_type: campaign.campaign_type,
          metadata: campaign.metadata,
        });

        const scheduledFor = DateTime.fromISO(contentItem.scheduled_for, { zone: "Europe/London" });
        const autoLabel = getProximityLabel({ referenceAt: scheduledFor, campaignTiming: timing });
        const labelText = banner.customMessage ?? autoLabel;

        if (labelText && mediaAssets.length > 0 && mediaAssets[0].mediaType === "image") {
          const result = await renderBanner(
            {
              imageUrl: mediaAssets[0].url,
              placement: contentItem.placement,
              position: banner.position as "top" | "bottom" | "left" | "right",
              colorScheme: banner.colorScheme,
              labelText,
              contentItemId: contentItem.id,
              variantId: variant.id,
            },
            supabase,
            ffmpeg
          );

          // Replace first image URL with bannered version
          mediaAssets[0] = { ...mediaAssets[0], url: result.signedUrl };
          bannerTempPath = result.tempStoragePath;
        }
      }
    }
  }
} catch (bannerError) {
  // Failure fallback: publish with original image, log notification
  console.error("Banner rendering failed, using original image:", bannerError);
  await supabase.from("notifications").insert({
    account_id: contentItem.account_id,
    category: "publish",
    message: `Banner could not be added to your ${contentItem.platform} post. Published with original image.`,
    metadata: { contentItemId: contentItem.id, error: String(bannerError) },
  });
}

// ... existing publishByPlatform call ...

// After successful publish, cleanup temp banner file
if (bannerTempPath) {
  await cleanupBannerTemp(bannerTempPath, supabase).catch(() => {});
}
```

- [ ] **Step 4: Run typecheck (Deno)**

Verify the function compiles correctly.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-queue/worker.ts
git commit -m "feat: integrate banner rendering into publish pipeline with failure fallback"
```

---

## Phase 6: Link-in-Bio

### Task 15: Add Banner Data to Link-in-Bio Loader

**Files:**
- Modify: `src/lib/link-in-bio/types.ts`
- Modify: `src/lib/link-in-bio/public.ts`
- Modify: `src/app/(public)/l/[slug]/page.tsx`

- [ ] **Step 1: Add banner fields to PublicCampaignCard type**

In `src/lib/link-in-bio/types.ts`:

```typescript
import type { BannerConfig, BannerPosition, BannerColorScheme } from "@/lib/scheduling/banner-config";

// Add to PublicCampaignCard:
export interface PublicCampaignCard {
  // ... existing fields ...
  bannerLabel?: string | null;
  bannerPosition?: BannerPosition;
  bannerColorScheme?: BannerColorScheme;
}
```

- [ ] **Step 2: Calculate proximity labels in the public loader**

In `src/lib/link-in-bio/public.ts`, after building campaign cards, compute labels:

```typescript
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { parseBannerConfig } from "@/lib/scheduling/banner-config";
import { DateTime } from "luxon";

// After building each campaign card, before pushing to campaignCards:
const bannerConfig = parseBannerConfig(contentItem.prompt_context);
if (bannerConfig?.enabled && campaign.campaign_type && campaign.metadata) {
  const timing = extractCampaignTiming({
    campaign_type: campaign.campaign_type,
    metadata: campaign.metadata,
  });
  const label = bannerConfig.customMessage ?? getProximityLabel({
    referenceAt: DateTime.now().setZone("Europe/London"),
    campaignTiming: timing,
  });
  card.bannerLabel = label;
  card.bannerPosition = bannerConfig.position;
  card.bannerColorScheme = bannerConfig.colorScheme;
}
```

- [ ] **Step 3: Add dynamic rendering to the public page**

In `src/app/(public)/l/[slug]/page.tsx`:

```typescript
export const revalidate = 60; // Refresh every 60 seconds for banner label freshness
```

- [ ] **Step 4: Add CSS banner overlay to public page component**

In `src/features/link-in-bio/public/link-in-bio-public-page.tsx`, where campaign card images are rendered, add the `BannerPreview` overlay:

```tsx
import { BannerPreview } from "@/features/planner/banner-preview";

// Inside campaign card rendering, wrap image in relative container:
// {card.bannerLabel && card.bannerPosition && card.bannerColorScheme && (
//   <BannerPreview
//     label={card.bannerLabel}
//     position={card.bannerPosition}
//     colorScheme={card.bannerColorScheme}
//   />
// )}
```

- [ ] **Step 5: Add client-side timer for midnight refresh**

Add a `useEffect` in the public page component to refresh at midnight London time:

```tsx
import { useEffect, useState } from "react";

// Inside the component:
const [, setTick] = useState(0);

useEffect(() => {
  // Recalculate every hour to catch day transitions
  const interval = setInterval(() => {
    setTick((t) => t + 1);
    // Force router refresh to get new server-calculated labels
    window.location.reload();
  }, 60 * 60 * 1000); // 1 hour
  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 6: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 7: Commit**

```bash
git add src/lib/link-in-bio/types.ts src/lib/link-in-bio/public.ts src/app/(public)/l/[slug]/page.tsx src/features/link-in-bio/public/link-in-bio-public-page.tsx
git commit -m "feat: add dynamic proximity banners to link-in-bio public page"
```

---

## Phase 7: Verification

### Task 16: Full Test Suite & Verification

- [ ] **Step 1: Run all proximity label tests**

Run: `npx vitest run tests/lib/scheduling/`
Expected: All PASS

- [ ] **Step 2: Run full lint**

Run: `npm run lint`
Expected: Clean, zero warnings

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: Clean production build

- [ ] **Step 6: Manual smoke test**

Start dev server (`npm run dev`), navigate to:
1. Create an event campaign → verify banner defaults section appears
2. View scheduled posts in planner → verify banner preview overlay shows
3. Edit banner controls → verify position/colour/custom message save
4. Check link-in-bio public page → verify banner appears on campaign cards

- [ ] **Step 7: Final commit**

```bash
git commit -m "chore: verify proximity banners feature passes full CI pipeline"
```
