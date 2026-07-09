import { DateTime } from "luxon";

import type { SuggestedSlotDisplay } from "@/features/create/schedule/schedule-calendar";
import { buildEventCadenceSlots } from "@/lib/create/event-cadence";
import { DEFAULT_POST_TIME } from "@/lib/constants";

interface EventSuggestionInput {
  startDate: string | undefined;
  startTime: string;
  timezone: string;
}

interface PromotionSuggestionInput {
  endDate: string | undefined;
  timezone: string;
}

function parseDate(date: string | undefined, timezone: string) {
  if (!date) return DateTime.now().setZone(timezone).startOf("day");
  const parsed = DateTime.fromISO(date, { zone: timezone });
  return parsed.isValid ? parsed.startOf("day") : DateTime.now().setZone(timezone).startOf("day");
}

function normaliseTime(time: string, fallback = DEFAULT_POST_TIME) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return fallback;
  }
  return time;
}

function safeIsoDate(dateTime: DateTime): string | null {
  if (!dateTime.isValid) {
    return null;
  }
  return dateTime.toISODate() ?? dateTime.toFormat("yyyy-LL-dd");
}

interface WeeklyMultiDaySuggestionInput {
  startDate: string | undefined;
  daysOfWeek: number[] | undefined;
  time: string;
  endDate: string;
  timezone: string;
}

/**
 * Build one suggestion per selected weekday, from today up to and including
 * `endDate`. Days use JS getDay() convention (0=Sunday..6=Saturday). Slots
 * earlier than now + 15 minutes are skipped. Ids are date-unique
 * ("weekly-YYYY-MM-DD"); labels are "<Weekday> · Week <n>" with the week counted
 * from the first emitted occurrence.
 */
export function buildWeeklyMultiDaySuggestions({
  startDate,
  daysOfWeek,
  time,
  endDate,
  timezone,
}: WeeklyMultiDaySuggestionInput): SuggestedSlotDisplay[] {
  if (!daysOfWeek?.length) return [];

  const selected = new Set(daysOfWeek.map((d) => ((d % 7) + 7) % 7));
  const start = parseDate(startDate, timezone); // startOf('day')
  const end = parseDate(endDate, timezone).endOf('day');
  if (!end.isValid || end < start) return [];

  const minimumSlot = DateTime.now().setZone(timezone).plus({ minutes: 15 }).startOf('minute');
  const [hourStr, minuteStr] = normaliseTime(time, DEFAULT_POST_TIME).split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const occurrences: DateTime[] = [];
  let cursor = start;
  // Hard stop well beyond any realistic end date to guarantee termination.
  let guard = 0;
  while (cursor <= end && guard < 800) {
    guard += 1;
    const jsWeekday = cursor.weekday % 7; // Luxon 1..7 (Sun=7) → JS 0..6 (Sun=0)
    if (selected.has(jsWeekday)) {
      const slot = cursor.set({ hour, minute, second: 0, millisecond: 0 });
      if (slot.isValid && slot >= minimumSlot && slot <= end) {
        occurrences.push(slot);
      }
    }
    cursor = cursor.plus({ days: 1 });
  }

  occurrences.sort((a, b) => a.toMillis() - b.toMillis());
  const anchorWeekStart = occurrences.length ? occurrences[0].startOf('week') : null;

  return occurrences.map((slot) => {
    const weekNum = anchorWeekStart
      ? Math.floor(slot.startOf('week').diff(anchorWeekStart, 'weeks').weeks) + 1
      : 1;
    const dateIso = safeIsoDate(slot) ?? slot.toFormat('yyyy-LL-dd');
    return {
      id: `weekly-${dateIso}`,
      date: dateIso,
      time: slot.toFormat('HH:mm'),
      label: `${slot.toFormat('cccc')} · Week ${weekNum}`,
    } satisfies SuggestedSlotDisplay;
  });
}

export function buildEventSuggestions({ startDate, startTime, timezone }: EventSuggestionInput): SuggestedSlotDisplay[] {
  const slots = buildEventCadenceSlots({ startDate, startTime, timezone });
  return slots.map((slot) => ({
    id: `event-${slot.id}`,
    date: safeIsoDate(slot.occurs) ?? slot.occurs.toFormat("yyyy-LL-dd"),
    time: slot.occurs.toFormat("HH:mm"),
    label: slot.label,
  }));
}

/**
 * Filters suggestions away from occupied days (existing planner items + sibling suggestions).
 * "Event day" suggestions (label === "Event day") are pinned: they keep their date.
 * Other cadence-labelled suggestions ("X days to go", "Weekly hype · N weeks out",
 * promotion "Launch"/"Mid-run reminder"/"Last chance") carry meaning relative to a specific
 * date — shifting them would mislabel the suggestion. So if their slot is occupied, they're
 * dropped rather than shifted onto a different day. The user can still add a custom slot
 * on any empty day.
 */
export function deconflictSuggestions(
  suggestions: SuggestedSlotDisplay[],
  existingItems: Array<{ date: string }>,
  // The third parameter (originally a timezone for shift arithmetic) is now unused —
  // we no longer compute candidate dates because shifted cadence labels would mislead
  // users. Kept in the signature to avoid touching every caller.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _timezone: string,
): SuggestedSlotDisplay[] {
  if (!suggestions.length) return suggestions;

  // Build a set of occupied day keys from existing planner items
  const occupiedDays = new Set<string>();
  for (const item of existingItems) {
    if (item.date) {
      occupiedDays.add(item.date);
    }
  }

  // Track which days our own output suggestions will occupy
  const claimedDays = new Set<string>();

  const result: SuggestedSlotDisplay[] = [];

  for (const suggestion of suggestions) {
    const isPinned = suggestion.label === "Event day";
    const originalDate = suggestion.date;

    if (isPinned) {
      // Pinned suggestions keep their date; claim the day
      claimedDays.add(originalDate);
      // Event day posts go at 17:00
      result.push({ ...suggestion, time: "17:00" });
      continue;
    }

    // Drop suggestions whose slot is already occupied: their label
    // ("3 days to go", "Weekly hype · 2 weeks out", etc.) is tied to a
    // specific date, so shifting onto a different day would mislabel them.
    if (occupiedDays.has(originalDate) || claimedDays.has(originalDate)) {
      continue;
    }

    claimedDays.add(originalDate);
    result.push({ ...suggestion });
  }

  return result;
}

export function buildPromotionSuggestions({
  endDate,
  timezone,
}: PromotionSuggestionInput): SuggestedSlotDisplay[] {
  const start = DateTime.now().setZone(timezone).startOf("day");
  const end = parseDate(endDate, timezone).set({ hour: 17, minute: 0 });
  const minimumSlot = DateTime.now().setZone(timezone).plus({ minutes: 15 }).startOf("minute");

  const duration = Math.max(0, end.diff(start, "hours").hours ?? 0);
  const mid = start.plus({ hours: duration / 2 });
  let lastChance = end.minus({ hours: 6 });
  if (lastChance <= start) {
    lastChance = end.minus({ hours: 2 });
  }

  const [defaultHour, defaultMinute] = DEFAULT_POST_TIME.split(":").map(Number);
  const toMorning = (value: DateTime) =>
    value.set({ hour: defaultHour, minute: defaultMinute, second: 0, millisecond: 0 });

  const slots = [
    { id: "launch", label: "Launch", occurs: toMorning(start) },
    { id: "mid", label: "Mid-run reminder", occurs: toMorning(mid) },
    { id: "last", label: "Last chance", occurs: toMorning(lastChance) },
  ];

  return slots
    .filter((slot) => slot.occurs.isValid && slot.occurs >= minimumSlot)
    .map((slot) => ({
      id: `promo-${slot.id}`,
      date: safeIsoDate(slot.occurs) ?? slot.occurs.toFormat("yyyy-LL-dd"),
      time: slot.occurs.toFormat("HH:mm"),
      label: slot.label,
    } satisfies SuggestedSlotDisplay));
}
