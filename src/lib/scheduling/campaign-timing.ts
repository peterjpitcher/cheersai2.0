// src/lib/scheduling/campaign-timing.ts
import { DateTime } from "luxon";

const DEFAULT_TZ = "Europe/London";

/**
 * Convert a JS getDay() weekday (0=Sunday..6=Saturday) — the format used by
 * weekly campaign metadata — into a Luxon weekday (1=Monday..7=Sunday).
 * Falls back to 1 (Monday) for non-numeric input.
 */
function jsDayToLuxonWeekday(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n < 0 || n > 6) return 1;
  // JS: 0=Sun..6=Sat → Luxon: 7=Sun, 1=Mon, ..., 6=Sat
  return n === 0 ? 7 : n;
}

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
    // metadata.dayOfWeek is stored in JS getDay() format (0=Sunday..6=Saturday)
    // — see src/lib/create/schema.ts:weeklyCampaignSchema.dayOfWeek and
    // supabase/functions/materialise-weekly/utils.ts:clampDay. We translate
    // to Luxon weekday (1=Monday..7=Sunday) here so getNextWeeklyOccurrence
    // and downstream banner-label code use the correct weekday math.
    return {
      campaignType: "weekly",
      startAt: DateTime.now().setZone(tz), // placeholder — weekly uses dayOfWeek
      weeklyDayOfWeek: jsDayToLuxonWeekday(meta.dayOfWeek),
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
