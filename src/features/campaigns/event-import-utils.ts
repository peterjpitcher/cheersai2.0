import { DateTime } from "luxon";

/**
 * Formats event details into a pre-filled problem brief string.
 * e.g. "Acoustic Fridays on 2026-03-20. A fantastic live music evening."
 */
export function buildBriefFromEvent(
  name: string,
  date: string | undefined,
  description: string | undefined,
): string {
  const datePart = date ? ` on ${date}` : "";
  const descPart = description?.trim() ? ` ${description.trim()}` : "";
  return `${name}${datePart}.${descPart}`.trim();
}

/**
 * Returns the campaign start date: 7 days before the event, but no earlier than today.
 * Input and output are ISO date strings (YYYY-MM-DD).
 */
export function deriveStartDate(eventDate: string): string {
  const today = DateTime.now().toISODate() ?? "";
  const sevenBefore = DateTime.fromISO(eventDate).minus({ days: 7 }).toISODate() ?? "";
  return sevenBefore >= today ? sevenBefore : today;
}
