import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { MetaAdSetScheduleEntry, MetaAdSetScheduleReadBack } from '@/lib/meta/marketing';
import type { DeliverySchedule, RunDay } from '@/types/campaigns';

/**
 * Delivery schedules for evergreen Meta campaigns: the days and whole hours an ad set may
 * deliver (Meta "day parting"). Pure, with no I/O, so the brief form, the server actions and
 * the publish preflight all apply exactly the same rules.
 *
 * Hours are in the ad account's time zone: the schedule goes to Meta with timezone_type
 * ADVERTISER and publish refuses unless the ad account is on Europe/London. So "09:00" means
 * 09:00 UK time in GMT and in BST alike; Meta applies the clock change, not this code.
 */

/** The only time zone a schedule is written for. Publish checks the ad account against it. */
export const DELIVERY_SCHEDULE_TIMEZONE = DEFAULT_TIMEZONE;

/** Week order for storage and display, Monday first. */
export const RUN_DAY_ORDER: readonly RunDay[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

export const RUN_DAY_LABELS: Record<RunDay, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

// Meta numbers days from Sunday = 0.
const META_DAY_NUMBERS: Record<RunDay, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// Luxon numbers weekdays ISO style, from Monday = 1.
const LUXON_WEEKDAYS: Record<RunDay, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

// Evergreen flights are capped at 30 days elsewhere; this only bounds the loop on bad input.
const MAX_FLIGHT_DAYS = 400;

export interface DeliveryScheduleContext {
  campaignKind: string | null | undefined;
  budgetType: string | null | undefined;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
}

function isRunDay(value: unknown): value is RunDay {
  return typeof value === 'string' && (RUN_DAY_ORDER as readonly string[]).includes(value);
}

/** The first problem with the schedule's own shape, or null. Campaign rules are separate. */
function findShapeProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'The delivery schedule is not valid.';
  }

  const { days, startHour, endHour } = value as Record<string, unknown>;
  if (!Array.isArray(days) || days.length === 0) {
    return 'Choose at least one delivery day.';
  }
  if (!days.every(isRunDay)) {
    return 'The delivery schedule contains an unknown day.';
  }
  if (new Set(days).size !== days.length) {
    return 'Each delivery day can only be chosen once.';
  }
  if (
    typeof startHour !== 'number'
    || typeof endHour !== 'number'
    || !Number.isInteger(startHour)
    || !Number.isInteger(endHour)
  ) {
    return 'Delivery hours must be whole hours.';
  }
  if (startHour < 0 || endHour > 24 || startHour >= endHour) {
    return 'Delivery must end after it starts, between 00:00 and 24:00.';
  }

  return null;
}

/** True when the value has a valid schedule shape: known days, no repeats, whole hours. */
export function isDeliverySchedule(value: unknown): value is DeliverySchedule {
  return findShapeProblem(value) === null;
}

function parseLondonDate(value: string | null | undefined): DateTime | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = DateTime.fromISO(value, { zone: DELIVERY_SCHEDULE_TIMEZONE });
  return parsed.isValid ? parsed.startOf('day') : null;
}

/**
 * Steps one calendar day at a time with Luxon rather than adding 24 hours, so a flight across
 * a clock change (25 October 2026, say) visits each London date exactly once.
 */
function scheduledDatesBetween(schedule: DeliverySchedule, start: DateTime, end: DateTime): string[] {
  const wanted = new Set(schedule.days.map((day) => LUXON_WEEKDAYS[day]));
  const dates: string[] = [];
  let cursor = start;
  for (let step = 0; step < MAX_FLIGHT_DAYS && cursor <= end; step++) {
    const iso = cursor.toISODate();
    if (iso && wanted.has(cursor.weekday)) dates.push(iso);
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

/**
 * Every date from start to end inclusive (YYYY-MM-DD, Europe/London calendar days) that falls
 * on a scheduled day. Empty for invalid or reversed dates.
 */
export function listScheduledDeliveryDates(
  schedule: DeliverySchedule,
  startDate: string,
  endDate: string,
): string[] {
  const start = parseLondonDate(startDate);
  const end = parseLondonDate(endDate);
  if (!start || !end || end < start) return [];
  return scheduledDatesBetween(schedule, start, end);
}

/**
 * The first reason this schedule cannot be used on this campaign, in plain English, or null
 * when it can. No schedule (null or undefined) is always fine: it means deliver at any time.
 * Takes `unknown` because server action input and the stored column are untrusted.
 */
export function validateDeliverySchedule(
  value: unknown,
  context: DeliveryScheduleContext,
): string | null {
  if (value === null || value === undefined) return null;

  if (context.campaignKind !== 'evergreen') {
    return 'Delivery days and hours are only available for evergreen campaigns.';
  }
  if (context.budgetType !== 'LIFETIME') {
    return 'Delivery days and hours need a total budget. Meta does not allow them on a daily budget.';
  }

  const shapeProblem = findShapeProblem(value);
  if (shapeProblem) return shapeProblem;
  const schedule = value as DeliverySchedule;

  if (!context.endDate) {
    return 'Set an end date. A total budget with delivery days and hours needs one.';
  }
  const start = parseLondonDate(context.startDate);
  const end = parseLondonDate(context.endDate);
  if (!start || !end) {
    return 'Set valid campaign start and end dates.';
  }
  if (end < start) {
    return 'The campaign end date must be on or after the start date.';
  }
  if (scheduledDatesBetween(schedule, start, end).length === 0) {
    return `None of the chosen delivery days fall between ${formatLongDate(start)} and ${formatLongDate(end)}. Choose other days or change the dates.`;
  }

  return null;
}

/** Canonical stored form: days in week order and only the three known fields. */
export function normaliseDeliverySchedule(schedule: DeliverySchedule): DeliverySchedule {
  return {
    days: RUN_DAY_ORDER.filter((day) => schedule.days.includes(day)),
    startHour: schedule.startHour,
    endHour: schedule.endHour,
  };
}

/**
 * The Meta `adset_schedule` for this schedule: one window covering every chosen day, minutes
 * from midnight in the ad account's time zone (hence ADVERTISER), days from Sunday = 0.
 */
export function toMetaAdSetSchedule(schedule: DeliverySchedule): MetaAdSetScheduleEntry[] {
  const days = [...new Set(schedule.days.map((day) => META_DAY_NUMBERS[day]))].sort((a, b) => a - b);
  return [
    {
      start_minute: schedule.startHour * 60,
      end_minute: schedule.endHour * 60,
      days,
      timezone_type: 'ADVERTISER',
    },
  ];
}

// Keyed on day and minutes only. The time zone type is deliberately not compared: publish
// refuses unless the ad account is on Europe/London, and every campaign targets a small
// radius around the venue in Great Britain, so ADVERTISER time and USER (viewer) time are
// the same clock. Meta may also leave the field out of a read-back, and that must not strand
// a correct schedule in draft.
function expandScheduleEntries(entries: MetaAdSetScheduleEntry[]): string[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    for (const day of entry.days) {
      keys.add(`${day}|${entry.start_minute}|${entry.end_minute}`);
    }
  }
  return [...keys].sort();
}

/**
 * True when what Meta reports for an ad set is the schedule that was sent: day parting on,
 * and exactly the same windows, day by day. Compared per day so Meta may group or order the
 * windows differently. Anything missing counts as a mismatch.
 */
export function metaAdSetScheduleMatches(
  expected: MetaAdSetScheduleEntry[],
  readBack: MetaAdSetScheduleReadBack,
): boolean {
  if (!readBack.pacingType.includes('day_parting')) return false;

  const expectedKeys = expandScheduleEntries(expected);
  const actualKeys = expandScheduleEntries(readBack.adsetSchedule);
  return expectedKeys.length > 0
    && expectedKeys.length === actualKeys.length
    && expectedKeys.every((key, index) => key === actualKeys[index]);
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Tuesday to Friday", "Saturday and Sunday", "Monday to Wednesday and Friday", "every day". */
export function describeDeliveryDays(days: readonly RunDay[]): string {
  const ordered = RUN_DAY_ORDER.filter((day) => days.includes(day));
  if (ordered.length === RUN_DAY_ORDER.length) return 'every day';

  // Group consecutive days (Monday first) into runs, so Tue, Wed, Thu, Fri reads as a range.
  const runs: RunDay[][] = [];
  for (const day of ordered) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    if (current && previous && RUN_DAY_ORDER.indexOf(previous) === RUN_DAY_ORDER.indexOf(day) - 1) {
      current.push(day);
    } else {
      runs.push([day]);
    }
  }

  const parts = runs.flatMap((run) =>
    run.length >= 3
      ? [`${RUN_DAY_LABELS[run[0]!]} to ${RUN_DAY_LABELS[run[run.length - 1]!]}`]
      : run.map((day) => RUN_DAY_LABELS[day]),
  );
  return joinWithAnd(parts);
}

/** An hour of the day as "09:00"; 24 is "midnight" (the end of the day). */
export function formatDeliveryHour(hour: number): string {
  return hour === 24 ? 'midnight' : `${String(hour).padStart(2, '0')}:00`;
}

/** "09:00 to 14:00", "18:00 to midnight", or "all day". */
export function describeDeliveryHours(startHour: number, endHour: number): string {
  if (startHour === 0 && endHour === 24) return 'all day';
  return `${formatDeliveryHour(startHour)} to ${formatDeliveryHour(endHour)}`;
}

/** Plain English for the prompt and the UI, for example "Tuesday to Friday, 09:00 to 14:00". */
export function describeDeliverySchedule(schedule: DeliverySchedule): string {
  return `${describeDeliveryDays(schedule.days)}, ${describeDeliveryHours(schedule.startHour, schedule.endHour)}`;
}

function formatLongDate(date: DateTime): string {
  return date.setLocale('en-GB').toFormat('d LLLL yyyy');
}
