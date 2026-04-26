// KEEP IN SYNC WITH: src/lib/scheduling/proximity-label.ts and campaign-timing.ts
// This is a Deno-compatible duplicate for the Edge Function runtime.

import { DateTime } from "https://esm.sh/luxon@3.5.0";

// ---------------------------------------------------------------------------
// CampaignTiming
// ---------------------------------------------------------------------------

const DEFAULT_TZ = "Europe/London";

export interface CampaignTiming {
  campaignType: "event" | "promotion" | "weekly" | "story_series";
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
      startAt: DateTime.now().setZone(tz),
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
    const endAt =
      typeof meta.endDate === "string"
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

  const resolvedType = campaign.campaign_type === "story_series" ? "story_series" : "event";

  return {
    campaignType: resolvedType,
    startAt,
    startTime,
    timezone: tz,
  };
}

/**
 * Calculate the next occurrence of a weekly event day relative to referenceAt.
 */
export function getNextWeeklyOccurrence(
  referenceAt: DateTime,
  dayOfWeek: number,
  timezone: string,
): DateTime {
  const ref = referenceAt.setZone(timezone).startOf("day");
  const currentWeekday = ref.weekday; // 1=Mon..7=Sun

  let daysUntil = dayOfWeek - currentWeekday;
  if (daysUntil < 0) {
    daysUntil += 7;
  }

  return ref.plus({ days: daysUntil });
}

// ---------------------------------------------------------------------------
// ProximityLabel
// ---------------------------------------------------------------------------

export type ProximityLabel = string | null;

export interface ProximityLabelInput {
  referenceAt: DateTime;
  campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
  "",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

function isEvening(startTime?: string): boolean {
  if (!startTime) return false;
  const hour = parseInt(startTime.split(":")[0], 10);
  return hour >= EVENING_THRESHOLD_HOUR;
}

function getEventStartTimestamp(
  eventDate: DateTime,
  startTime: string | undefined,
  timezone: string,
): DateTime {
  if (!startTime) {
    return eventDate.setZone(timezone).endOf("day");
  }
  const [h, m] = startTime.split(":").map(Number);
  return eventDate
    .setZone(timezone)
    .set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
  referenceAt: DateTime,
  timing: CampaignTiming,
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const eventDay = timing.startAt.setZone(tz).startOf("day");

  const eventTimestamp = getEventStartTimestamp(
    timing.startAt,
    timing.startTime,
    tz,
  );
  if (referenceAt >= eventTimestamp) {
    return null;
  }

  const daysDiff = eventDay.diff(refDay, "days").days;

  if (daysDiff <= 0) {
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

function getPromotionLabel(
  referenceAt: DateTime,
  timing: CampaignTiming,
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const startDay = timing.startAt.setZone(tz).startOf("day");

  const endDay = timing.endAt
    ? timing.endAt.setZone(tz).startOf("day")
    : undefined;
  const endEOD = endDay ? endDay.endOf("day") : undefined;

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

  // Before promotion start
  const daysDiff = startDay.diff(refDay, "days").days;

  if (daysDiff <= 0) return "TODAY";
  if (daysDiff === 1) return "TOMORROW";
  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[startDay.weekday];
    return `THIS ${weekdayName}`;
  }

  return null; // 7+ days before start
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
        campaignTiming.timezone,
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

    case "story_series":
      return getEventLabel(referenceAt, campaignTiming);

    default:
      return null;
  }
}
