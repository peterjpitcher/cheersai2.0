import { DateTime } from 'luxon';

/**
 * Convert a YYYY-MM-DD calendar date to the UTC ISO string representing
 * midnight in the Europe/London timezone on that date.
 *
 * During GMT  (UTC+0, late October → late March): midnight London = 00:00 UTC same calendar day.
 * During BST  (UTC+1, late March  → late October): midnight London = 23:00 UTC previous calendar day.
 */
export function toMidnightLondon(isoDate: string): string {
  return toLondonDateTime(isoDate, '00:00');
}

export function toLondonDateTime(isoDate: string, time: string): string {
  const parsed = DateTime.fromISO(`${isoDate}T${time}`, { zone: 'Europe/London' });
  if (!parsed.isValid) {
    throw new Error(`Invalid London date/time: ${isoDate} ${time}`);
  }

  const iso = parsed.toUTC().toISO({ suppressMilliseconds: false });
  if (!iso) {
    throw new Error(`Could not convert London date/time: ${isoDate} ${time}`);
  }

  return iso;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const parsed = DateTime.fromISO(isoDate, { zone: 'UTC' }).plus({ days });
  if (!parsed.isValid) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  const result = parsed.toISODate();
  if (!result) {
    throw new Error(`Could not add days to ISO date: ${isoDate}`);
  }

  return result;
}

export function toNextMidnightLondon(isoDate: string): string {
  return toMidnightLondon(addDaysToIsoDate(isoDate, 1));
}
