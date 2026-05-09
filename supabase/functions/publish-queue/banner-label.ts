// supabase/functions/publish-queue/banner-label.ts
//
// DUPLICATED from src/lib/scheduling/campaign-timing.ts and
// src/lib/scheduling/proximity-label.ts because Deno cannot resolve the
// `@/...` alias used in Node code. Keep the timing extraction and label
// derivation logic in sync with the canonical sources in src/lib/scheduling/.
// The same intentional-duplication pattern is already used by
// supabase/functions/materialise-weekly/utils.ts.

import { DateTime } from "https://esm.sh/luxon@3.7.2";

const DEFAULT_TZ = "Europe/London";

/**
 * Convert a JS getDay() weekday (0=Sunday..6=Saturday) — the format used by
 * weekly campaign metadata — into a Luxon weekday (1=Monday..7=Sunday).
 * Falls back to 1 (Monday) for non-numeric input. Mirrors
 * src/lib/scheduling/campaign-timing.ts:jsDayToLuxonWeekday — keep in sync.
 */
function jsDayToLuxonWeekday(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    if (n < 0 || n > 6) return 1;
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
        // metadata.dayOfWeek is JS getDay() (0=Sun..6=Sat). Translate to
        // Luxon weekday (1=Mon..7=Sun) so getNextWeeklyOccurrence works.
        return {
            campaignType: "weekly",
            startAt: DateTime.now().setZone(tz),
            weeklyDayOfWeek: jsDayToLuxonWeekday(meta.dayOfWeek),
            startTime: typeof meta.time === "string" ? meta.time : undefined,
            timezone: tz,
        };
    }

    let startAt: DateTime;
    if (typeof meta.startDate === "string") {
        startAt = DateTime.fromISO(meta.startDate, { zone: tz });
    } else if (typeof meta.eventStart === "string") {
        startAt = DateTime.fromISO(meta.eventStart, { zone: tz });
    } else {
        startAt = DateTime.now().setZone(tz);
    }

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

export function getNextWeeklyOccurrence(
    referenceAt: DateTime,
    dayOfWeek: number,
    timezone: string,
): DateTime {
    const ref = referenceAt.setZone(timezone).startOf("day");
    const currentWeekday = ref.weekday;

    let daysUntil = dayOfWeek - currentWeekday;
    if (daysUntil < 0) {
        daysUntil += 7;
    }

    return ref.plus({ days: daysUntil });
}

export type ProximityLabel = string | null;

export interface ProximityLabelInput {
    referenceAt: DateTime;
    campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
    "", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const MONTH_SHORT = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
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
    return eventDate.setZone(timezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
    referenceAt: DateTime,
    timing: CampaignTiming,
): ProximityLabel {
    const tz = timing.timezone;
    const refDay = referenceAt.setZone(tz).startOf("day");
    const eventDay = timing.startAt.setZone(tz).startOf("day");

    const eventTimestamp = getEventStartTimestamp(timing.startAt, timing.startTime, tz);
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

    const targetInTz = timing.startAt.setZone(tz);

    if (daysDiff >= 2 && daysDiff <= 6) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `THIS ${weekdayName}`;
    }

    // 7+ days → use calendar-week difference, not raw days
    const refWeekStart = refDay.startOf("week");
    const eventWeekStart = eventDay.startOf("week");
    const weekDiff = Math.round(
        eventWeekStart.diff(refWeekStart, "weeks").weeks,
    );

    if (weekDiff === 1) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `NEXT ${weekdayName}`;
    }

    const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
    const monthShort = MONTH_SHORT[targetInTz.month - 1];
    return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
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
    const endEOD = endDay
        ? endDay.endOf("day")
        : undefined;

    if (endEOD && referenceAt > endEOD) {
        return null;
    }

    if (referenceAt >= timing.startAt.setZone(tz).startOf("day")) {
        if (!endDay) return "ON NOW";

        const daysToEnd = endDay.diff(refDay, "days").days;

        if (daysToEnd <= 0) return "LAST DAY";
        if (daysToEnd === 1) return "ENDS TOMORROW";
        if (daysToEnd >= 2 && daysToEnd <= 6) return `${daysToEnd} DAYS LEFT`;

        const weeksToEnd = Math.floor(daysToEnd / 7);
        return `${weeksToEnd} ${weeksToEnd === 1 ? "WEEK" : "WEEKS"} LEFT`;
    }

    const daysDiff = startDay.diff(refDay, "days").days;

    if (daysDiff <= 0) return "TODAY";
    if (daysDiff === 1) return "TOMORROW";
    if (daysDiff >= 2 && daysDiff <= 6) {
        const weekdayName = WEEKDAY_NAMES[startDay.weekday];
        return `THIS ${weekdayName}`;
    }

    return null;
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

        default:
            return null;
    }
}
