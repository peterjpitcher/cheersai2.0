/**
 * Spread-evenly scheduling algorithm for weekly campaigns.
 *
 * Distributes posts across the emptiest days in a scheduling window,
 * optionally staggering platforms onto different days for maximum
 * calendar coverage.
 */

type Platform = "facebook" | "instagram" | "gbp";

export interface SpreadConfig {
  postsPerWeek: number;
  platforms: Platform[];
  staggerPlatforms: boolean;
  windowStart: Date;
  windowEnd: Date;
}

export interface SpreadSlot {
  date: Date;
  platform: Platform;
}

/** Platform priority order: Instagram first (visual teaser), Facebook second, GBP last (SEO). */
const PLATFORM_PRIORITY: Platform[] = ["instagram", "facebook", "gbp"];

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

  // Sort platforms by priority order
  const orderedPlatforms = [...platforms].sort(
    (a, b) => PLATFORM_PRIORITY.indexOf(a) - PLATFORM_PRIORITY.indexOf(b),
  );

  // Build day-occupancy map: count feed posts per day key
  const occupancy = new Map<string, number>();
  for (const post of existingPosts) {
    if (post.placement === "story") continue; // Stories don't count
    const dayKey = toDayKey(post.scheduledFor);
    occupancy.set(dayKey, (occupancy.get(dayKey) ?? 0) + 1);
  }

  // Enumerate weeks in the window
  const weeks = getWeeksInWindow(windowStart, windowEnd);
  const allSlots: SpreadSlot[] = [];

  for (const week of weeks) {
    const weekSlots = placePostsForWeek(
      week,
      orderedPlatforms,
      postsPerWeek,
      staggerPlatforms,
      occupancy,
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
): SpreadSlot[] {
  // Score and sort days by occupancy (emptiest first), then by date for stability
  const scoredDays = weekDays.map((day) => {
    const dayKey = toDayKey(day);
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

/** Get the ISO date string (YYYY-MM-DD) for a date. */
function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Enumerate weeks in the window.
 * Each "week" is an array of days (Date objects) that fall within the window.
 * Weeks run Monday-Sunday.
 */
function getWeeksInWindow(windowStart: Date, windowEnd: Date): Date[][] {
  const weeks: Date[][] = [];
  let current = new Date(windowStart);

  // Find the Monday of the first week
  const startDay = current.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
  const weekMonday = new Date(current);
  weekMonday.setDate(weekMonday.getDate() + mondayOffset);

  let pointer = new Date(weekMonday);

  while (pointer <= windowEnd) {
    const weekDays: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(pointer);
      day.setDate(pointer.getDate() + i);
      // Only include days within the window
      if (day >= windowStart && day <= windowEnd) {
        weekDays.push(day);
      }
    }
    if (weekDays.length > 0) {
      weeks.push(weekDays);
    }
    // Move to next Monday
    pointer.setDate(pointer.getDate() + 7);
  }

  return weeks;
}
