import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";

/**
 * Format a Date as a friendly 12-hour time string (e.g. "6pm", "1:30pm").
 * Converts to the project default timezone before formatting.
 */
export function formatFriendlyTime(date: Date): string {
  const zoned = DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE });
  return formatFriendlyTimeFromZoned(zoned);
}

/**
 * Format a Luxon DateTime (already zoned) as a friendly 12-hour time string.
 */
export function formatFriendlyTimeFromZoned(zoned: DateTime): string {
  const hours = zoned.hour;
  const minutes = zoned.minute;
  const suffix = hours >= 12 ? "pm" : "am";
  const hour12 = ((hours + 11) % 12) + 1;
  if (minutes === 0) {
    return `${hour12}${suffix}`;
  }
  const minuteStr = minutes.toString().padStart(2, "0");
  return `${hour12}:${minuteStr}${suffix}`;
}

/**
 * Ordinal suffix for a day of the month: 1 -> "st", 2 -> "nd", 3 -> "rd",
 * 11/12/13 -> "th", etc.
 */
export function ordinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return "th";
  }
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Format an event date as "Friday 17th July" — weekday, ordinal day, full
 * month, no year. Proper case (en-GB) for use in body copy; callers wanting the
 * uppercase overlay form should `.toUpperCase()` the result.
 *
 * Accepts a Luxon DateTime, a JS Date, or an ISO string. Always resolves in the
 * project default timezone (Europe/London) unless overridden, so a late-evening
 * UTC instant renders on the correct local calendar day.
 */
export function formatEventDateLong(
  input: DateTime | Date | string,
  options?: { zone?: string },
): string {
  const zone = options?.zone ?? DEFAULT_TIMEZONE;
  let dt: DateTime;
  if (DateTime.isDateTime(input)) {
    dt = input.setZone(zone);
  } else if (input instanceof Date) {
    dt = DateTime.fromJSDate(input, { zone });
  } else {
    dt = DateTime.fromISO(input, { zone });
  }
  dt = dt.setLocale("en-GB");
  const weekday = dt.toFormat("cccc");
  const month = dt.toFormat("LLLL");
  return `${weekday} ${dt.day}${ordinalSuffix(dt.day)} ${month}`;
}

function toLondonDateTime(input: Date | string): DateTime {
  return input instanceof Date
    ? DateTime.fromJSDate(input, { zone: DEFAULT_TIMEZONE })
    : DateTime.fromISO(input, { zone: DEFAULT_TIMEZONE });
}

/**
 * Format an instant as a UK date, "06/09/2026", on the Europe/London calendar.
 *
 * Use this instead of `toLocaleDateString()` in anything that renders on the
 * server. There the runtime is UTC and en-US ("9/6/2026") while the browser is
 * usually en-GB and London time, so a bare call makes the server HTML and the
 * browser render disagree and React throws the server HTML away (error #418).
 * Explicit tokens and zone give the same string in every runtime.
 *
 * Returns "" for input that is not a valid date.
 */
export function formatUkDate(input: Date | string): string {
  const dt = toLondonDateTime(input);
  return dt.isValid ? dt.toFormat("dd/MM/yyyy") : "";
}

/**
 * Format an instant as a UK date and time, "06/09/2026, 14:30:15", in
 * Europe/London time: the layout en-GB `toLocaleString()` gives in a UK
 * browser, but identical on the server. Returns "" for an invalid date.
 */
export function formatUkDateTime(input: Date | string): string {
  const dt = toLondonDateTime(input);
  return dt.isValid ? dt.toFormat("dd/MM/yyyy, HH:mm:ss") : "";
}
