import { DateTime } from "luxon";

import type { SuggestedSlotDisplay } from "@/features/create/schedule/schedule-calendar";
import { buildEventCadenceSlots } from "@/lib/create/event-cadence";
import { DEFAULT_POST_TIME } from "@/lib/constants";

interface WeeklySuggestionInput {
  startDate: string | undefined;
  dayOfWeek: number;
  time: string;
  weeksAhead: number;
  timezone: string;
}

interface EventSuggestionInput {
  startDate: string | undefined;
  startTime: string;
  timezone: string;
}

interface PromotionSuggestionInput {
  startDate: string | undefined;
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

export function buildWeeklySuggestions({
  startDate,
  dayOfWeek,
  time,
  weeksAhead,
  timezone,
}: WeeklySuggestionInput): SuggestedSlotDisplay[] {
  const baseDate = parseDate(startDate, timezone);
  const minimumSlot = DateTime.now().setZone(timezone).plus({ minutes: 15 }).startOf("minute");
  const [hourStr, minuteStr] = normaliseTime(time, DEFAULT_POST_TIME).split(":");
  let occurrence = baseDate.set({ hour: Number(hourStr), minute: Number(minuteStr), second: 0, millisecond: 0 });

  const jsWeekday = occurrence.weekday % 7; // luxon: Monday=1 … Sunday=7 -> 0
  let diff = (dayOfWeek - jsWeekday + 7) % 7;
  if (diff === 0 && occurrence < baseDate) {
    diff = 7;
  }
  occurrence = occurrence.plus({ days: diff });

  while (occurrence < minimumSlot) {
    occurrence = occurrence.plus({ weeks: 1 });
  }

  const total = Math.max(1, Math.min(weeksAhead, 12));

  return Array.from({ length: total })
    .map((_, index) => occurrence.plus({ weeks: index }))
    .filter((slot) => slot.isValid)
    .map((slot, index) => ({
      id: `week-${index + 1}`,
      date: safeIsoDate(slot) ?? slot.toFormat("yyyy-LL-dd"),
      time: slot.toFormat("HH:mm"),
      label: `Week ${index + 1}`,
    } satisfies SuggestedSlotDisplay));
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
 * Shifts suggestions away from occupied days (existing planner items + sibling suggestions).
 * "Event day" suggestions (label === "Event day") are pinned and never moved.
 * When a day has 2+ suggestions, the first (closest to anchor date) stays; others shift to the
 * nearest empty day within ±2 days. If no empty day is found, the suggestion keeps its original date.
 */
export function deconflictSuggestions(
  suggestions: SuggestedSlotDisplay[],
  existingItems: Array<{ date: string }>,
  timezone: string,
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

    // Check if this day is already occupied by an existing item or another suggestion
    if (!occupiedDays.has(originalDate) && !claimedDays.has(originalDate)) {
      claimedDays.add(originalDate);
      result.push({ ...suggestion });
      continue;
    }

    // Try to shift to an empty day — search ±1 through ±4 days, preferring earlier
    const baseDay = DateTime.fromISO(originalDate, { zone: timezone });
    let shifted = false;

    for (let offset = 1; offset <= 4; offset++) {
      for (const direction of [-1, 1] as const) {
        const candidate = baseDay.plus({ days: offset * direction });
        if (!candidate.isValid) continue;
        const candidateDate = candidate.toISODate();
        if (!candidateDate) continue;

        if (!occupiedDays.has(candidateDate) && !claimedDays.has(candidateDate)) {
          claimedDays.add(candidateDate);
          result.push({ ...suggestion, date: candidateDate });
          shifted = true;
          break;
        }
      }
      if (shifted) break;
    }

    // If no empty slot found within ±2 days, keep original date
    if (!shifted) {
      claimedDays.add(originalDate);
      result.push({ ...suggestion });
    }
  }

  return result;
}

export function buildPromotionSuggestions({
  startDate,
  endDate,
  timezone,
}: PromotionSuggestionInput): SuggestedSlotDisplay[] {
  const start = parseDate(startDate, timezone);
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
