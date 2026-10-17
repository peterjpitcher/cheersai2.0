// src/lib/scheduling/proximity-label.ts
import { DateTime } from "luxon";
import type { CampaignTiming } from "./campaign-timing";
import { getNextWeeklyOccurrenceForDays } from "./campaign-timing";
import { formatEventDateLong } from "@/lib/utils/date";
import { MAX_STORY_PROMPT_LENGTH } from "@/lib/banner/text";

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
      const days = campaignTiming.weeklyDaysOfWeek?.length
        ? campaignTiming.weeklyDaysOfWeek
        : campaignTiming.weeklyDayOfWeek
          ? [campaignTiming.weeklyDayOfWeek]
          : [];
      if (!days.length) return null;
      const nextOccurrence = getNextWeeklyOccurrenceForDays(
        referenceAt,
        days,
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

// --- Story booking prompt ---------------------------------------------------
// Duplicated in supabase/functions/publish-queue/banner-label.ts: keep in sync.
// tests/lib/scheduling/proximity-label-parity.test.ts checks the two agree.
//
// Meta's publishing API cannot add link stickers to stories, so an event story
// says where to book in its artwork instead (tasks/SPEC-story-booking-prompt.md).

/** Approved by the owner on 17 October 2026. */
export const STORY_PROMPT_INSTAGRAM = "LINK IN BIO TO BOOK";

/**
 * Facebook text for a brand with no usable website. Still true: the Page
 * carries the paired feed post with the booking link.
 */
export const STORY_PROMPT_FACEBOOK_FALLBACK = "SEE OUR PAGE TO BOOK";

export interface StoryBookingPromptInput {
  platform: string | null | undefined;
  placement: string | null | undefined;
  campaignType: string | null | undefined;
  promptContext: unknown;
  /** The brand's website (link_in_bio_profiles.website_url). Only Facebook uses it. */
  websiteUrl?: string | null;
}

/**
 * The booking prompt drawn on an event story, or null when it gets none.
 *
 * A story qualifies when its own platform has a booking link in the brief.
 * That is the same test that gives the paired feed post its booking line
 * (readPlatformCtaLinks and resolvePlatformCtaUrl in
 * src/lib/publishing/copy-rules.ts), mirrored here so this module stays free
 * of publishing imports. Instagram always says "LINK IN BIO TO BOOK";
 * Facebook names the brand's website, e.g. "BOOK AT THE-ANCHOR.PUB".
 */
export function getStoryBookingPrompt(input: StoryBookingPromptInput): string | null {
  if (input.placement !== "story" || input.campaignType !== "event") return null;
  const platform = input.platform;
  if (platform !== "facebook" && platform !== "instagram") return null;
  if (!readStoryBookingLink(input.promptContext, platform)) return null;
  if (platform === "instagram") return STORY_PROMPT_INSTAGRAM;

  const domain = websiteDomain(input.websiteUrl);
  const prompt = domain ? `BOOK AT ${domain}` : null;
  return prompt && prompt.length <= MAX_STORY_PROMPT_LENGTH ? prompt : STORY_PROMPT_FACEBOOK_FALLBACK;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStoryBookingLink(promptContext: unknown, platform: "facebook" | "instagram"): string | null {
  const ctaLinks = asRecord(asRecord(asRecord(promptContext)?.brief)?.ctaLinks);
  const raw = ctaLinks?.[platform];
  if (typeof raw !== "string") return null;
  const link = raw.trim();
  return /^https?:\/\//i.test(link) ? link : null;
}

/**
 * The website as a bare domain in capitals ("THE-ANCHOR.PUB"), or null when it
 * is missing or not a plain domain: another scheme, credentials, an IP address
 * or an international domain in its xn-- form.
 */
function websiteDomain(websiteUrl: string | null | undefined): string | null {
  const raw = websiteUrl?.trim();
  if (!raw) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host.includes("xn--") || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return null;
  return host.toUpperCase();
}
