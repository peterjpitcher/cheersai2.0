import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { formatEventDateLong } from '@/lib/utils/date';

/**
 * When an event's promotion may start (tasks/SPEC-next-event-only.md): the day
 * after the event before it, whatever its type, so the posts point at one
 * event at a time: the next one. It replaces the 17 October 2026 rule, which
 * only held back two nights of one series (same category). A cancelled event
 * still counts as the event before. Pure, so the wizard can use it too.
 */
export interface PromotionWindow {
  /** London date (YYYY-MM-DD) from which posts may go out. */
  opensOn: string;
  /** The event before this one, which has to finish first. */
  afterEvent: string;
  /** Its London date (YYYY-MM-DD). */
  afterDate: string;
  /** The earlier event's type, as the events system names it (for example "Music Bingo"); kept for posts stored under the old rule. */
  category: string;
}

export interface WindowEvent {
  id: string;
  name?: string | null;
  date?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
}

export interface WindowTarget {
  eventId?: string;
  /** The event's London date (YYYY-MM-DD). */
  eventDate: string;
  categorySlug?: string | null;
  categoryName?: string | null;
}

/** The window for one event, from the events before it; null when there is no earlier event. */
export function promotionWindowFrom(events: WindowEvent[], target: WindowTarget): PromotionWindow | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target.eventDate)) return null;

  // Any earlier event counts, not only one of the same type. Both dates are
  // YYYY-MM-DD London dates, so comparing the strings compares the days; an
  // event on the same day does not hold this one back.
  const earlier = events.filter(
    (event): event is WindowEvent & { date: string } =>
      event.id !== target.eventId && typeof event.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.date < target.eventDate,
  );
  if (!earlier.length) return null;

  const last = earlier.reduce((latest, event) => (event.date > latest.date ? event : latest));
  const opensOn = DateTime.fromISO(last.date, { zone: DEFAULT_TIMEZONE }).plus({ days: 1 }).toISODate();
  if (!opensOn) return null;
  return {
    opensOn,
    afterEvent: last.name?.trim() || 'the event before it',
    afterDate: last.date,
    category: last.categoryName?.trim() || 'event',
  };
}

/** Whether a London date (YYYY-MM-DD) falls before the window opens. */
export function beforePromotionWindow(londonDate: string, window: PromotionWindow | null | undefined): boolean {
  return Boolean(window && londonDate < window.opensOn);
}

/** The reason a date before the window is refused, in the owner's words. */
export function promotionWindowMessage(eventName: string, window: PromotionWindow): string {
  return `${eventName} can be promoted from ${formatEventDateLong(window.opensOn)}, after ${window.afterEvent} on ${formatEventDateLong(window.afterDate)}.`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The window a scheduled post was created under, read from its stored
 * prompt_context.brief, so a later move is held to the same rule. Null when the
 * post has none (typed by hand, or scheduled before the rule existed).
 */
export function storedPromotionWindow(promptContext: unknown): { eventName: string; window: PromotionWindow } | null {
  if (!promptContext || typeof promptContext !== 'object') return null;
  const brief = (promptContext as { brief?: unknown }).brief;
  if (!brief || typeof brief !== 'object') return null;
  const { promotionWindow, eventName, title } = brief as { promotionWindow?: unknown; eventName?: unknown; title?: unknown };
  if (!promotionWindow || typeof promotionWindow !== 'object') return null;
  const { opensOn, afterEvent, afterDate, category } = promotionWindow as Record<string, unknown>;
  if (typeof opensOn !== 'string' || !ISO_DATE.test(opensOn)) return null;
  if (typeof afterDate !== 'string' || !ISO_DATE.test(afterDate)) return null;
  const name = [eventName, title].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return {
    eventName: name?.trim() ?? 'This event',
    window: {
      opensOn,
      afterDate,
      afterEvent: typeof afterEvent === 'string' && afterEvent.trim() ? afterEvent.trim() : 'the last one',
      category: typeof category === 'string' && category.trim() ? category.trim() : 'event of its type',
    },
  };
}
