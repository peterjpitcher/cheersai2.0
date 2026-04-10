/**
 * Spread-evenly scheduling algorithm for weekly campaigns.
 *
 * Distributes posts across the emptiest days in a scheduling window,
 * optionally staggering platforms onto different days for maximum
 * calendar coverage.
 *
 * All day arithmetic uses Luxon in the target timezone to avoid DST
 * boundary bugs that occur when native Date methods assume the process
 * timezone (typically UTC on servers).
 */

import { DateTime } from "luxon";

type Platform = "facebook" | "instagram" | "gbp";

export interface SpreadConfig {
  postsPerWeek: number;
  platforms: Platform[];
  staggerPlatforms: boolean;
  windowStart: Date;
  windowEnd: Date;
  /** IANA timezone for calendar-day calculations (e.g. "Europe/London"). */
  timezone?: string;
}

export interface SpreadSlot {
  date: Date;
  platform: Platform;
}

/** Platform priority order: Instagram first (visual teaser), Facebook second, GBP last (SEO). */
const PLATFORM_PRIORITY: Platform[] = ["instagram", "facebook", "gbp"];

/** Fallback timezone when none provided (matches project default). */
const DEFAULT_TZ = "Europe/London";

/**
 * Build a list of spread-evenly slots across the scheduling window.
 *
 * Algorithm:
 * 1. Build day-occupancy map from existingPosts (feed posts only).
 * 2. For each week in the window:
 *    a. Score days by occupancy (empty=0, 1 post=1, 2+=2).
 *    b. Sort days by score ascending (emptiest first), then by date.
 *    c. If staggerPlatforms: assign each platform to a different day.
 *    d. If not staggering: assign all platforms to the same day (emptiest).
 *    e. Place postsPerWeek slots total across the week.
 * 3. Return the complete list of SpreadSlot[].
 */
export function buildSpreadEvenlySlots(
  config: SpreadConfig,
  existingPosts: Array<{ scheduledFor: Date; platform: string; placement: string }>,
): SpreadSlot[] {
  const { postsPerWeek, platforms, staggerPlatforms, windowStart, windowEnd } = config;
  const tz = config.timezone ?? DEFAULT_TZ;

  // Sort platforms by priority order
  const orderedPlatforms = [...platforms].sort(
    (a, b) => PLATFORM_PRIORITY.indexOf(a) - PLATFORM_PRIORITY.indexOf(b),
  );

  // Build day-occupancy map: count feed posts per day key
  const occupancy = new Map<string, number>();
  for (const post of existingPosts) {
    if (post.placement === "story") continue; // Stories don't count
    const dayKey = toDayKey(post.scheduledFor, tz);
    occupancy.set(dayKey, (occupancy.get(dayKey) ?? 0) + 1);
  }

  // Enumerate weeks in the window
  const weeks = getWeeksInWindow(windowStart, windowEnd, tz);
  const allSlots: SpreadSlot[] = [];

  for (const week of weeks) {
    const weekSlots = placePostsForWeek(
      week,
      orderedPlatforms,
      postsPerWeek,
      staggerPlatforms,
      occupancy,
      tz,
    );
    allSlots.push(...weekSlots);
  }

  return allSlots;
}

/** Score a day: empty=0, 1 post=1, 2+=2. */
function scoreDay(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  return 2;
}

/**
 * Place posts for a single week.
 *
 * When staggering, each platform gets its own day (if possible).
 * When not staggering, all platforms share the emptiest day.
 */
function placePostsForWeek(
  weekDays: Date[],
  platforms: Platform[],
  postsPerWeek: number,
  stagger: boolean,
  occupancy: Map<string, number>,
  tz: string,
): SpreadSlot[] {
  // Score and sort days by occupancy (emptiest first), then by date for stability
  const scoredDays = weekDays.map((day) => {
    const dayKey = toDayKey(day, tz);
    const count = occupancy.get(dayKey) ?? 0;
    return { day, dayKey, score: scoreDay(count) };
  });
  scoredDays.sort((a, b) => a.score - b.score || a.day.getTime() - b.day.getTime());

  const slots: SpreadSlot[] = [];

  if (stagger && platforms.length > 1) {
    // Stagger: assign each platform to a different day
    // postsPerWeek determines how many "post sets" we place;
    // each set uses one day per platform
    const setsToPlace = Math.max(1, Math.ceil(postsPerWeek / platforms.length));

    for (let setIdx = 0; setIdx < setsToPlace; setIdx++) {
      let dayIndex = 0;
      for (const platform of platforms) {
        if (slots.length >= postsPerWeek) break;

        // Find the next available day (reuse least-busy if we run out)
        const targetDay =
          dayIndex < scoredDays.length
            ? scoredDays[dayIndex]!
            : scoredDays[scoredDays.length - 1]!;

        slots.push({ date: new Date(targetDay.day), platform });

        // Update occupancy for subsequent assignments within this week
        occupancy.set(targetDay.dayKey, (occupancy.get(targetDay.dayKey) ?? 0) + 1);
        dayIndex++;
      }

      // Re-sort for next set if needed
      if (setIdx < setsToPlace - 1) {
        scoredDays.forEach((sd) => {
          sd.score = scoreDay(occupancy.get(sd.dayKey) ?? 0);
        });
        scoredDays.sort((a, b) => a.score - b.score || a.day.getTime() - b.day.getTime());
      }
    }
  } else {
    // No stagger: all platforms on the same day per post
    const postsToPlace = postsPerWeek;
    for (let i = 0; i < postsToPlace; i++) {
      // Pick the emptiest day
      const targetDay = scoredDays[0]!;

      for (const platform of platforms) {
        slots.push({ date: new Date(targetDay.day), platform });
      }

      // Update occupancy and re-sort
      occupancy.set(targetDay.dayKey, (occupancy.get(targetDay.dayKey) ?? 0) + platforms.length);
      scoredDays[0]!.score = scoreDay(occupancy.get(targetDay.dayKey) ?? 0);
      scoredDays.sort((a, b) => a.score - b.score || a.day.getTime() - b.day.getTime());
    }
  }

  return slots;
}

/**
 * Select an engagement-optimised posting hour for a scheduled date.
 *
 * Priority:
 * 1. If defaultPostingTime is set and valid (HH:mm), use it.
 * 2. If eventDate is the same calendar day, return 17:00 (5pm — after-work crowd).
 * 3. Otherwise return 12:00 (noon — lunch browsers).
 */
export function getEngagementOptimisedHour(
  scheduledDate: Date,
  eventDate: Date | null,
  defaultPostingTime: string | null,
  timezone?: string,
): { hour: number; minute: number } {
  const tz = timezone ?? DEFAULT_TZ;

  // 1. User-configured default posting time takes precedence
  if (defaultPostingTime && /^\d{2}:\d{2}$/.test(defaultPostingTime)) {
    const [hourStr, minuteStr] = defaultPostingTime.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // 2. Same-day event: 5pm (high intent, after-work audience)
  if (eventDate && isSameCalendarDay(scheduledDate, eventDate, tz)) {
    return { hour: 17, minute: 0 };
  }

  // 3. Default: noon (lunch browsers, planning ahead)
  return { hour: 12, minute: 0 };
}

/** Check if two dates fall on the same calendar day in the target timezone. */
function isSameCalendarDay(a: Date, b: Date, tz: string): boolean {
  const aLocal = DateTime.fromJSDate(a, { zone: tz });
  const bLocal = DateTime.fromJSDate(b, { zone: tz });
  return (
    aLocal.year === bLocal.year &&
    aLocal.month === bLocal.month &&
    aLocal.day === bLocal.day
  );
}

/** Get the ISO date string (YYYY-MM-DD) for a date in the target timezone. */
function toDayKey(date: Date, tz: string): string {
  const dt = DateTime.fromJSDate(date, { zone: tz });
  return dt.toISODate() ?? `${dt.year}-${String(dt.month).padStart(2, "0")}-${String(dt.day).padStart(2, "0")}`;
}

/**
 * Enumerate weeks in the window.
 * Each "week" is an array of days (Date objects) that fall within the window.
 * Weeks run Monday-Sunday. All day arithmetic uses Luxon in the target timezone.
 */
function getWeeksInWindow(windowStart: Date, windowEnd: Date, tz: string): Date[][] {
  const weeks: Date[][] = [];
  const startDt = DateTime.fromJSDate(windowStart, { zone: tz }).startOf("day");
  const endDt = DateTime.fromJSDate(windowEnd, { zone: tz }).startOf("day");

  // Find the Monday of the first week
  // Luxon weekday: 1=Monday, 7=Sunday
  const weekMonday = startDt.minus({ days: startDt.weekday - 1 });

  let pointer = weekMonday;

  while (pointer <= endDt) {
    const weekDays: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = pointer.plus({ days: i });
      // Only include days within the window
      if (day >= startDt && day <= endDt) {
        weekDays.push(day.toJSDate());
      }
    }
    if (weekDays.length > 0) {
      weeks.push(weekDays);
    }
    // Move to next Monday
    pointer = pointer.plus({ days: 7 });
  }

  return weeks;
}
