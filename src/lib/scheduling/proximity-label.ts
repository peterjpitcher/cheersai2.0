// src/lib/scheduling/proximity-label.ts
import { DateTime } from "luxon";
import type { CampaignTiming } from "./campaign-timing";
import { getNextWeeklyOccurrence } from "./campaign-timing";
import { formatEventDateLong } from "@/lib/utils/date";

// Duplicated in supabase/functions/publish-queue/banner-label.ts — keep in sync
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

  const targetInTz = timing.startAt.setZone(tz);

  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
    return `THIS ${weekdayName}`;
  }

  // 7+ days → use calendar-week difference, not raw days, to disambiguate
  // "next Saturday" (1 week ahead) from "Saturday week-after-next" (2 weeks ahead).
  // Luxon's startOf("week") returns Monday 00:00; rounding the diff handles
  // DST-shortened (23h) and DST-lengthened (25h) weeks correctly.
  const refWeekStart = refDay.startOf("week");
  const eventWeekStart = eventDay.startOf("week");
  const weekDiff = Math.round(
    eventWeekStart.diff(refWeekStart, "weeks").weeks
  );

  if (weekDiff === 1) {
    const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
    return `NEXT ${weekdayName}`;
  }

  // weekDiff >= 2 → unambiguous full date, e.g. "FRIDAY 17TH JULY"
  return formatEventDateLong(targetInTz, { zone: tz }).toUpperCase();
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
        campaignTiming.startTime
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
    if (daysToEnd >= 2 && daysToEnd <= 6) return `${daysToEnd} DAYS LEFT`;

    const weeksToEnd = Math.floor(daysToEnd / 7);
    return `${weeksToEnd} ${weeksToEnd === 1 ? "WEEK" : "WEEKS"} LEFT`;
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
