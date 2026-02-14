import { DateTime } from "luxon";

import { DEFAULT_POST_TIME, DEFAULT_TIMEZONE } from "@/lib/constants";

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
const MAX_WEEKLY_BEATS = 8;

const [POST_HOUR, POST_MINUTE] = DEFAULT_POST_TIME.split(":").map(Number);

export function buildEventCadenceSlots(params: EventCadenceParams): EventCadenceSlot[] {
  return resolveEventCadence(params).slots;
}

export function buildEventScheduleOffsets(params: EventCadenceParams) {
  const { slots, eventStart } = resolveEventCadence(params);
  if (!slots.length) {
    const fallbackOccurs = applyPostingTime(eventStart).minus({ days: 1 });
    return [{ label: "1 day to go", offsetHours: fallbackOccurs.diff(eventStart, "hours").hours ?? -24 }];
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
    { id: "minus-3d", label: "3 days to go", shift: { days: 3 } },
    { id: "minus-2d", label: "2 days to go", shift: { days: 2 } },
    { id: "minus-1d", label: "1 day to go", shift: { days: 1 } },
  ] as const;

  const slots: EventCadenceSlot[] = [];
  for (const def of countdownDefs) {
    const occurs = scheduleBase.minus(def.shift);
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

function normaliseTime(time: string | undefined, fallback = FALLBACK_TIME) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return fallback;
  }
  return time;
}
