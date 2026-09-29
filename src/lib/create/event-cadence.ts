import { DateTime } from "luxon";

import { DEFAULT_POST_TIME, DEFAULT_TIMEZONE, EVENT_DAY_POST_TIME } from "@/lib/constants";

export interface EventCadenceParams {
  startDate: string | Date | undefined;
  startTime: string | undefined;
  timezone?: string;
  now?: Date;
  maxWeekly?: number;
}

export interface EventCadenceSlot {
  id: string;
  label: string;
  occurs: DateTime;
}

const FALLBACK_TIME = DEFAULT_POST_TIME;
const MAX_WEEKLY_BEATS = 4;

const [POST_HOUR, POST_MINUTE] = DEFAULT_POST_TIME.split(":").map(Number);
const [EVENT_DAY_HOUR, EVENT_DAY_MINUTE] = EVENT_DAY_POST_TIME.split(":").map(Number);

export function buildEventCadenceSlots(params: EventCadenceParams): EventCadenceSlot[] {
  return resolveEventCadence(params).slots;
}

export function buildEventScheduleOffsets(params: EventCadenceParams) {
  const { slots, eventStart } = resolveEventCadence(params);
  if (!slots.length) {
    const fallbackOccurs = applyEventDayTime(eventStart);
    return [{ label: "Event day", offsetHours: fallbackOccurs.diff(eventStart, "hours").hours ?? 0 }];
  }
  return slots.map((slot) => ({
    label: slot.label,
    offsetHours: slot.occurs.diff(eventStart, "hours").hours ?? 0,
  }));
}

function resolveEventCadence(params: EventCadenceParams) {
  const timezone = params.timezone?.trim().length ? params.timezone : DEFAULT_TIMEZONE;
  const eventStart = resolveEventStart(params.startDate, params.startTime, timezone);
  const scheduleBase = applyPostingTime(eventStart);
  const nowReference = params.now
    ? DateTime.fromJSDate(params.now, { zone: timezone })
    : DateTime.now().setZone(timezone);
  const minimumSlot = nowReference.plus({ minutes: 15 }).startOf("minute");

  const weeklySlots = buildWeeklySlots({
    scheduleBase,
    minimumSlot,
    maxWeekly: params.maxWeekly ?? MAX_WEEKLY_BEATS,
  });
  const countdownSlots = buildCountdownSlots({ scheduleBase, minimumSlot });

  const slots = [...weeklySlots, ...countdownSlots];
  slots.sort((a, b) => a.occurs.toMillis() - b.occurs.toMillis());

  return { slots, eventStart };
}

function buildWeeklySlots({
  scheduleBase,
  minimumSlot,
  maxWeekly,
}: {
  scheduleBase: DateTime;
  minimumSlot: DateTime;
  maxWeekly: number;
}) {
  const slots: EventCadenceSlot[] = [];
  for (let weeksOut = 1; weeksOut <= maxWeekly; weeksOut += 1) {
    const occurs = scheduleBase.minus({ weeks: weeksOut });
    if (occurs < minimumSlot) break;
    slots.push({
      id: `weekly-${weeksOut}`,
      label: weeksOut === 1 ? "Weekly hype · 1 week out" : `Weekly hype · ${weeksOut} weeks out`,
      occurs,
    });
  }
  return slots;
}

function buildCountdownSlots({
  scheduleBase,
  minimumSlot,
}: {
  scheduleBase: DateTime;
  minimumSlot: DateTime;
}) {
  const countdownDefs = [
    { id: "minus-2d", label: "2 days to go", shift: { days: 2 } },
    { id: "minus-1d", label: "1 day to go", shift: { days: 1 } },
    { id: "event-day", label: "Event day", shift: { days: 0 } },
  ] as const;

  const slots: EventCadenceSlot[] = [];
  for (const def of countdownDefs) {
    const day = scheduleBase.minus(def.shift);
    // The event-day post goes out first thing (EVENT_DAY_POST_TIME) so people
    // still have time to see it and book; the days before stay at midday. It
    // is set here, where every event suggestion is built, so it holds whether
    // or not the planner already has posts (the wizard only deconflicts when
    // it does). 07:00 exists exactly once in London on both clock-change days,
    // whose shifts happen between 01:00 and 02:00, so set() needs no GMT/BST
    // handling: on Sunday 25 October 2026 it gives 07:00 GMT, the days before
    // stay 12:00 BST.
    const occurs = def.id === "event-day" ? applyEventDayTime(day) : day;
    if (occurs < minimumSlot) continue;
    slots.push({ id: def.id, label: def.label, occurs });
  }
  return slots;
}

function resolveEventStart(
  startDate: string | Date | undefined,
  startTime: string | undefined,
  timezone: string,
) {
  const baseDate =
    startDate instanceof Date
      ? DateTime.fromJSDate(startDate, { zone: timezone })
      : typeof startDate === "string"
        ? DateTime.fromISO(startDate, { zone: timezone })
        : DateTime.now().setZone(timezone);
  const normalizedDate = baseDate.isValid ? baseDate : DateTime.now().setZone(timezone);
  const [hourStr, minuteStr] = normaliseTime(startTime).split(":");
  return normalizedDate.set({
    hour: Number(hourStr),
    minute: Number(minuteStr),
    second: 0,
    millisecond: 0,
  });
}

function applyPostingTime(dateTime: DateTime) {
  return dateTime.set({
    hour: POST_HOUR,
    minute: POST_MINUTE,
    second: 0,
    millisecond: 0,
  });
}

function applyEventDayTime(dateTime: DateTime) {
  return dateTime.set({
    hour: EVENT_DAY_HOUR,
    minute: EVENT_DAY_MINUTE,
    second: 0,
    millisecond: 0,
  });
}

function normaliseTime(time: string | undefined, fallback = FALLBACK_TIME) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return fallback;
  }
  return time;
}
