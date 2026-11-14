/**
 * When an event ends, for Google profile event posts
 * (tasks/SPEC-gbp-posting-reintroduction.md, section 3).
 *
 * Google needs a start and an end for an event post and takes both as local
 * wall time with no zone, so everything here is Europe/London wall time. An
 * event with no resolvable end is "not eligible" for Google; that never stops
 * its Facebook or Instagram posts.
 *
 * Clock changes (GMT/BST):
 * - A wall time in the spring-forward gap (for example 01:30 on 28 March 2027)
 *   does not exist, so it is not eligible rather than silently moved an hour.
 * - A wall time in the repeated autumn hour (01:00 to 02:00 on 25 October 2026)
 *   happens twice; the first (BST) occurrence is used.
 */

import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';

export type EventEndProblem =
  | 'missing_start'
  | 'start_in_clock_change_gap'
  | 'missing_end_time'
  | 'invalid_end_time'
  | 'end_in_clock_change_gap'
  | 'end_before_start';

export type EventEndResult =
  | {
      ok: true;
      /** ISO instants with the London offset, the same shape as campaigns.metadata.eventStart. */
      start: string;
      end: string;
      /** London wall-clock parts, which is what Google is sent. */
      startDate: string;
      startTime: string;
      endDate: string;
      endTime: string;
    }
  | { ok: false; reason: EventEndProblem };

export interface EventEndInput {
  /** YYYY-MM-DD */
  startDate?: string | null;
  /** HH:MM */
  startTime?: string | null;
  /** YYYY-MM-DD, optional: only for an event that ends on a later day. */
  endDate?: string | null;
  /** HH:MM */
  endTime?: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What the owner is told when an event cannot go to Google. */
export const EVENT_END_MESSAGES: Record<EventEndProblem, string> = {
  missing_start: 'Add the event date and start time to post this event to Google.',
  start_in_clock_change_gap: 'That start time does not exist on the night the clocks go forward. Choose another time to post this event to Google.',
  missing_end_time: 'Add an end time to post this event to Google.',
  invalid_end_time: 'The end time must be in HH:MM form to post this event to Google.',
  end_in_clock_change_gap: 'That end time does not exist on the night the clocks go forward. Choose another time to post this event to Google.',
  end_before_start: 'The end date is before the start date. Correct it to post this event to Google.',
};

type WallTime = { ok: true; value: DateTime } | { ok: false; reason: 'invalid' | 'gap' };

/**
 * A London wall time as an instant. Luxon moves a time in the spring gap
 * forward an hour, so a result whose wall clock differs from what was asked
 * for is reported as a gap. For the repeated autumn hour the earlier (BST)
 * instant is returned, whichever one Luxon picked.
 */
function londonWallTime(date: string, time: string): WallTime {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return { ok: false, reason: 'invalid' };
  const parsed = DateTime.fromISO(`${date}T${time}`, { zone: DEFAULT_TIMEZONE });
  if (!parsed.isValid) return { ok: false, reason: 'invalid' };
  if (parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== `${date}T${time}`) return { ok: false, reason: 'gap' };

  const hourEarlier = parsed.minus({ hours: 1 });
  const isSecondOccurrence = hourEarlier.toFormat("yyyy-MM-dd'T'HH:mm") === `${date}T${time}`;
  return { ok: true, value: isSecondOccurrence ? hourEarlier : parsed };
}

function describe(start: DateTime, end: DateTime): EventEndResult {
  return {
    ok: true,
    start: start.toISO() ?? '',
    end: end.toISO() ?? '',
    startDate: start.toFormat('yyyy-MM-dd'),
    startTime: start.toFormat('HH:mm'),
    endDate: end.toFormat('yyyy-MM-dd'),
    endTime: end.toFormat('HH:mm'),
  };
}

/**
 * Resolve an event's start and end from what the event form holds.
 *
 * 1. No start: not eligible.
 * 2. An end time with no end date (or an end date equal to the start date)
 *    ends on the start date, unless it is at or before the start time (an
 *    overnight event, or 00:00, which the management app uses for midnight):
 *    then it ends the next day. The day is chosen first, then checked.
 * 3. A later end date needs an end time; an end date before the start is an error.
 * 4. No end time: not eligible. Nothing is guessed.
 */
export function resolveEventEnd(input: EventEndInput): EventEndResult {
  const startDate = input.startDate?.trim() ?? '';
  const startTime = input.startTime?.trim() ?? '';
  const endDate = input.endDate?.trim() ?? '';
  const endTime = input.endTime?.trim() ?? '';

  if (!startDate || !startTime) return { ok: false, reason: 'missing_start' };
  const start = londonWallTime(startDate, startTime);
  if (!start.ok) return { ok: false, reason: start.reason === 'gap' ? 'start_in_clock_change_gap' : 'missing_start' };

  if (!endTime) return { ok: false, reason: 'missing_end_time' };
  if (!TIME_PATTERN.test(endTime)) return { ok: false, reason: 'invalid_end_time' };
  if (endDate && !DATE_PATTERN.test(endDate)) return { ok: false, reason: 'end_before_start' };
  if (endDate && endDate < startDate) return { ok: false, reason: 'end_before_start' };

  // Which day the end falls on is decided from the wall clock BEFORE that day
  // is checked for a clock-change gap. With no later end date, an end time at
  // or before the start time (an overnight event, or 00:00, which the
  // management app uses for midnight) belongs to the next day; checking it
  // against the start day first would wrongly refuse 22:00 to 01:30 on the day
  // the clocks went forward, when 01:30 the next morning is a real time.
  const sameDay = !endDate || endDate === startDate;
  const rollsOver = sameDay && endTime <= startTime;
  const resolvedEndDate = !sameDay
    ? endDate
    : rollsOver
      ? DateTime.fromISO(startDate, { zone: DEFAULT_TIMEZONE }).plus({ days: 1 }).toFormat('yyyy-MM-dd')
      : startDate;

  const end = londonWallTime(resolvedEndDate, endTime);
  if (!end.ok) return { ok: false, reason: end.reason === 'gap' ? 'end_in_clock_change_gap' : 'invalid_end_time' };
  // Cannot happen after the checks above (a later day, or a later time the same
  // day, is always a later instant), but an end before its start must never be stored.
  if (end.value <= start.value) return { ok: false, reason: 'end_before_start' };

  return describe(start.value, end.value);
}

/**
 * The end to pre-fill on import when the management app holds a duration but
 * no end time: start plus that many real (elapsed) minutes. Returns the end
 * time, and an end date only when the form could not otherwise reproduce the
 * same end (an event of 24 hours or more). Null when there is nothing usable.
 */
export function eventEndFromDuration(input: {
  startDate?: string | null;
  startTime?: string | null;
  durationMinutes?: number | null;
}): { endTime: string; endDate?: string } | null {
  const minutes = input.durationMinutes;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  const start = londonWallTime(input.startDate?.trim() ?? '', input.startTime?.trim() ?? '');
  if (!start.ok) return null;

  const end = start.value.plus({ minutes: Math.round(minutes) });
  const endTime = end.toFormat('HH:mm');
  const endDate = end.toFormat('yyyy-MM-dd');

  const withoutDate = resolveEventEnd({ startDate: input.startDate, startTime: input.startTime, endTime });
  if (withoutDate.ok && withoutDate.endDate === endDate) return { endTime };

  const withDate = resolveEventEnd({ startDate: input.startDate, startTime: input.startTime, endDate, endTime });
  return withDate.ok ? { endTime, endDate } : null;
}
