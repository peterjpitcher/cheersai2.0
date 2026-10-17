import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { formatEventDateLong } from '@/lib/utils/date';

/**
 * When an event's promotion may start (tasks/SPEC-social-calendar-fill.md): the
 * day after the last event of the same type, so two nights of one series (the
 * monthly quiz, cash bingo or music bingo) are never promoted at the same time.
 * The type is the events system's category; a themed one-off in that category
 * counts, and so does a cancelled event. Pure, so the wizard can use it too.
 */
export interface PromotionWindow {
  /** London date (YYYY-MM-DD) from which posts may go out. */
  opensOn: string;
  /** The last event of the same type, which has to finish first. */
  afterEvent: string;
  /** Its London date (YYYY-MM-DD). */
  afterDate: string;
  /** The type, as the events system names it (for example "Music Bingo"). */
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

const normalise = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? '';

/** The window for one event, from the events before it; null when the rule cannot apply. */
export function promotionWindowFrom(events: WindowEvent[], target: WindowTarget): PromotionWindow | null {
  const slug = normalise(target.categorySlug);
  const name = normalise(target.categoryName);
  if ((!slug && !name) || !/^\d{4}-\d{2}-\d{2}$/.test(target.eventDate)) return null;

  const sameType = (event: WindowEvent): boolean =>
    slug ? normalise(event.categorySlug) === slug : normalise(event.categoryName) === name;
  const earlier = events.filter(
    (event): event is WindowEvent & { date: string } =>
      event.id !== target.eventId && typeof event.date === 'string' && event.date < target.eventDate && sameType(event),
  );
  if (!earlier.length) return null;

  const last = earlier.reduce((latest, event) => (event.date > latest.date ? event : latest));
  const opensOn = DateTime.fromISO(last.date, { zone: DEFAULT_TIMEZONE }).plus({ days: 1 }).toISODate();
  if (!opensOn) return null;
  return {
    opensOn,
    afterEvent: last.name?.trim() || 'the last one',
    afterDate: last.date,
    category: target.categoryName?.trim() || last.categoryName?.trim() || 'event of its type',
  };
}

/** Whether a London date (YYYY-MM-DD) falls before the window opens. */
export function beforePromotionWindow(londonDate: string, window: PromotionWindow | null | undefined): boolean {
  return Boolean(window && londonDate < window.opensOn);
}

/** The reason a date before the window is refused, in the owner's words. */
export function promotionWindowMessage(eventName: string, window: PromotionWindow): string {
  return `${eventName} can be promoted from ${formatEventDateLong(window.opensOn)}, after the last ${window.category} (${window.afterEvent}) on ${formatEventDateLong(window.afterDate)}.`;
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
