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
  weeklyDayOfWeek?: number; // 1=Mon..7=Sun (Luxon weekday) — first selected day
  weeklyDaysOfWeek?: number[]; // 1=Mon..7=Sun (Luxon weekdays) — all selected days
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
    // — see the weekly_recurring brief (content-schemas.ts) and
    // supabase/functions/materialise-weekly/utils.ts:clampDay. We translate
    // to Luxon weekday (1=Monday..7=Sunday) here so getNextWeeklyOccurrence
    // and downstream banner-label code use the correct weekday math.
    const startAt = typeof meta.startDate === "string"
      ? DateTime.fromISO(meta.startDate, { zone: tz })
      : DateTime.now().setZone(tz);
    const endAtSource = typeof meta.displayEndDate === "string"
      ? meta.displayEndDate
      : typeof meta.endDate === "string"
        ? meta.endDate
        : null;
    const endAt = endAtSource ? DateTime.fromISO(endAtSource, { zone: tz }) : undefined;

    // metadata.daysOfWeek (JS getDay 0=Sun..6=Sat) is written for multi-day weekly
    // campaigns; dayOfWeek (= first selected day) is kept for back-compat.
    const weeklyDaysSource = Array.isArray(meta.daysOfWeek) ? (meta.daysOfWeek as unknown[]) : null;
    const weeklyDaysOfWeek = weeklyDaysSource && weeklyDaysSource.length
      ? Array.from(new Set(weeklyDaysSource.map((d) => jsDayToLuxonWeekday(d)))).sort((a, b) => a - b)
      : undefined;

    return {
      campaignType: "weekly",
      startAt: startAt.isValid ? startAt : DateTime.now().setZone(tz),
      endAt: endAt?.isValid ? endAt : undefined,
      weeklyDayOfWeek: jsDayToLuxonWeekday(meta.dayOfWeek),
      weeklyDaysOfWeek,
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
 * If startTime is supplied and today's event time has already passed, advances
 * to next week so the banner doesn't disappear for the rest of event day.
 */
export function getNextWeeklyOccurrence(
  referenceAt: DateTime,
  dayOfWeek: number,
  timezone: string,
  startTime?: string
): DateTime {
  const ref = referenceAt.setZone(timezone).startOf("day");
  const currentWeekday = ref.weekday; // 1=Mon..7=Sun

  let daysUntil = dayOfWeek - currentWeekday;
  if (daysUntil < 0) {
    daysUntil += 7;
  } else if (daysUntil === 0 && startTime) {
    const [h, m] = startTime.split(":").map(Number);
    const todayEventTime = ref.set({ hour: h, minute: m });
    if (referenceAt >= todayEventTime) {
      daysUntil = 7;
    }
  }

  return ref.plus({ days: daysUntil });
}

/**
 * Return the soonest upcoming weekly occurrence across several weekdays.
 * Used for multi-day weekly campaigns so proximity/next-occurrence labels reflect
 * the nearest selected day rather than only the first. `daysOfWeek` must be
 * non-empty (callers guard); values are Luxon weekdays (1=Mon..7=Sun).
 */
export function getNextWeeklyOccurrenceForDays(
  referenceAt: DateTime,
  daysOfWeek: number[],
  timezone: string,
  startTime?: string
): DateTime {
  const occurrences = daysOfWeek.map((day) =>
    getNextWeeklyOccurrence(referenceAt, day, timezone, startTime)
  );
  return occurrences.reduce((soonest, current) => (current < soonest ? current : soonest));
}
