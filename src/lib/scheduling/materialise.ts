import { DateTime } from "luxon";

import type { ContentItem } from "@/types/content";

/**
 * A materialised calendar slot generated from a recurring content item.
 * Used by the planner calendar to display recurring campaigns as individual entries.
 */
export interface MaterialisedSlot {
  sourceId: string;
  scheduledAt: Date;
  contentType: 'weekly_recurring';
  title: string | null;
  status: ContentItem['status'];
  thumbnailUrl: string | null;
  placement: 'feed';
  platform?: ContentItem['platform'];
}

/**
 * Expand recurring content items into individual calendar slots within a date range.
 *
 * For each recurring item with a valid recurringDayOfWeek, generates one slot per week
 * at the configured time in Europe/London timezone. Respects weeksAhead from bodyDraft.
 *
 * @param recurring - Content items with contentType 'weekly_recurring'
 * @param rangeStart - Start of the calendar range (Luxon DateTime)
 * @param rangeEnd - End of the calendar range (Luxon DateTime)
 */
export function materialiseRecurring(
  recurring: ContentItem[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
  thumbnails?: Map<string, string>,
): MaterialisedSlot[] {
  const slots: MaterialisedSlot[] = [];

  for (const item of recurring) {
    // Skip items without a valid recurring day
    if (item.recurringDayOfWeek == null) continue;

    const draft = item.bodyDraft as Record<string, unknown> | null;
    const recurringTime = (draft?.recurringTime as string) ?? '12:00';
    const weeksAhead = typeof draft?.weeksAhead === 'number' ? draft.weeksAhead : 4;

    const [hourStr, minuteStr] = recurringTime.split(':');
    const hour = parseInt(hourStr, 10) || 12;
    const minute = parseInt(minuteStr, 10) || 0;

    // Convert JS dayOfWeek (0=Sunday) to Luxon weekday (1=Monday, 7=Sunday)
    const luxonWeekday = item.recurringDayOfWeek === 0
      ? 7
      : item.recurringDayOfWeek;

    let slotsGenerated = 0;
    let pointer = rangeStart.startOf('week'); // Monday in Luxon

    while (pointer <= rangeEnd && slotsGenerated < weeksAhead) {
      const target = pointer
        .set({ weekday: luxonWeekday as 1 | 2 | 3 | 4 | 5 | 6 | 7 })
        .set({ hour, minute, second: 0, millisecond: 0 });

      // Ensure target is within the requested range
      if (target >= rangeStart && target <= rangeEnd) {
        slots.push({
          sourceId: item.id,
          scheduledAt: target.toJSDate(),
          contentType: 'weekly_recurring',
          title: item.title,
          status: item.status,
          thumbnailUrl: thumbnails?.get(item.id) ?? item.thumbnailUrl ?? null,
          placement: 'feed',
          platform: item.platform ?? null,
        });
        slotsGenerated++;
      }

      pointer = pointer.plus({ weeks: 1 });
    }
  }

  return slots;
}
