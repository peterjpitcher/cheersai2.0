import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE, STORY_POST_TIME } from "@/lib/constants";

const MIN_STORY_LEAD_MINUTES = 15;

function storyPostTimeParts() {
  const [hourStr = "7", minuteStr = "0"] = STORY_POST_TIME.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  return {
    hour: Number.isFinite(hour) ? hour : 7,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

export function resolveStoryScheduledFor(
  value: string | Date | null | undefined,
  timezone = DEFAULT_TIMEZONE,
  now = DateTime.now().setZone(timezone),
): Date | null {
  if (!value) return null;

  const parsed =
    value instanceof Date
      ? DateTime.fromJSDate(value, { zone: timezone })
      : DateTime.fromISO(value, { zone: timezone });
  if (!parsed.isValid) return null;

  const { hour, minute } = storyPostTimeParts();
  let target = parsed.set({ hour, minute, second: 0, millisecond: 0 });
  const minimum = now.setZone(timezone).plus({ minutes: MIN_STORY_LEAD_MINUTES });

  while (target < minimum) {
    target = target.plus({ days: 1 });
  }

  return target.toJSDate();
}

export function formatStoryScheduleInputValue(
  value: string | Date | null | undefined,
  timezone = DEFAULT_TIMEZONE,
  now = DateTime.now().setZone(timezone),
): string {
  const scheduledFor = resolveStoryScheduledFor(value, timezone, now);
  if (!scheduledFor) return "";
  return DateTime.fromJSDate(scheduledFor, { zone: timezone }).toFormat("yyyy-MM-dd'T'HH:mm");
}
