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
