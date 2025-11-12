import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";

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

const FALLBACK_TIME = "07:00";
const MAX_WEEKLY_BEATS = 8;

export function buildEventCadenceSlots(params: EventCadenceParams): EventCadenceSlot[] {
  return resolveEventCadence(params).slots;
}

export function buildEventScheduleOffsets(params: EventCadenceParams) {
  const { slots, eventStart } = resolveEventCadence(params);
  if (!slots.length) {
    return [{ label: "Event day", offsetHours: 0 }];
  }
  return slots.map((slot) => ({
    label: slot.label,
    offsetHours: slot.occurs.diff(eventStart, "hours").hours ?? 0,
  }));
}

function resolveEventCadence(params: EventCadenceParams) {
  const timezone = params.timezone?.trim().length ? params.timezone : DEFAULT_TIMEZONE;
  const eventStart = resolveEventStart(params.startDate, params.startTime, timezone);
  const nowReference = params.now
    ? DateTime.fromJSDate(params.now, { zone: timezone })
    : DateTime.now().setZone(timezone);
  const minimumSlot = nowReference.plus({ minutes: 15 }).startOf("minute");

  const weeklySlots = buildWeeklySlots({
    eventStart,
    minimumSlot,
    maxWeekly: params.maxWeekly ?? MAX_WEEKLY_BEATS,
  });
  const countdownSlots = buildCountdownSlots({ eventStart, minimumSlot });

  const slots = [...weeklySlots, ...countdownSlots];
  slots.sort((a, b) => a.occurs.toMillis() - b.occurs.toMillis());

  return { slots, eventStart };
}

function buildWeeklySlots({
  eventStart,
  minimumSlot,
  maxWeekly,
}: {
  eventStart: DateTime;
  minimumSlot: DateTime;
  maxWeekly: number;
}) {
  const slots: EventCadenceSlot[] = [];
  for (let weeksOut = 1; weeksOut <= maxWeekly; weeksOut += 1) {
    const occurs = eventStart.minus({ weeks: weeksOut });
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
  eventStart,
  minimumSlot,
}: {
  eventStart: DateTime;
  minimumSlot: DateTime;
}) {
  const countdownDefs = [
    { id: "minus-3d", label: "3 days to go", shift: { days: 3 } },
    { id: "minus-2d", label: "2 days to go", shift: { days: 2 } },
    { id: "day-of", label: "Event day", shift: { days: 0 } },
  ] as const;

  const slots: EventCadenceSlot[] = [];
  for (const def of countdownDefs) {
    const occurs = eventStart.minus(def.shift);
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

function normaliseTime(time: string | undefined, fallback = FALLBACK_TIME) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return fallback;
  }
  return time;
}
