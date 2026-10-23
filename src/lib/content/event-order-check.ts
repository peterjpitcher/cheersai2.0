/**
 * The daily check of the event-order rule (tasks/SPEC-daily-event-order-check.md).
 *
 * An event's posts may start only after the last event of the same type has finished. The
 * wizard, the planner and the calendar tool hold to that when a post is created or moved; this
 * check catches a post that starts breaking it later, because an event moved in the events
 * system. It tells the owner in the app and changes nothing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import {
  listManagementEvents,
  type ManagementApiConfig,
  type ManagementEventListItem,
} from '@/lib/management-app/client';
import { beforePromotionWindow, promotionWindowMessage, type PromotionWindow } from '@/lib/management-app/promotion-window';
import { loadPromotionWindow } from '@/lib/management-app/promotion-window-loader';
import { insertNotification } from '@/lib/notifications/insert';
import { formatEventDateLong } from '@/lib/utils/date';

export const EVENT_ORDER_CATEGORY = 'event_order_conflict';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A scheduled event post, with the event facts stored in its brief when it was written. */
interface ScheduledEventPostRow {
  id: string;
  campaign_id: string | null;
  scheduled_for: string;
  event_name: string | null;
  event_date: string | null;
  category: string | null;
}

export interface EventOrderDeps {
  listEvents: typeof listManagementEvents;
  loadWindow: typeof loadPromotionWindow;
  notify: typeof insertNotification;
}

const DEFAULT_DEPS: EventOrderDeps = {
  listEvents: listManagementEvents,
  loadWindow: loadPromotionWindow,
  notify: insertNotification,
};

export interface EventOrderSummary {
  /** Campaigns (events) with posts still to go out. */
  campaigns: number;
  posts: number;
  /** Posts that go out before their event's window opens. */
  flagged: number;
  notified: number;
}

const normalise = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? '';

function londonDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(DEFAULT_TIMEZONE).toISODate() ?? '';
}

/**
 * The event in the events system with exactly this name, nearest the date the posts were
 * written for, so an event that has moved is found on its new date.
 */
export function findEvent(
  events: readonly ManagementEventListItem[],
  eventName: string,
  storedDate: string | null,
): ManagementEventListItem | null {
  const named = events.filter(
    (event) => normalise(event.name) === normalise(eventName) && typeof event.date === 'string' && ISO_DATE.test(event.date),
  );
  if (!named.length) return null;
  if (!storedDate || !ISO_DATE.test(storedDate)) return named[0];
  const distance = (date: string): number =>
    Math.abs(DateTime.fromISO(date).diff(DateTime.fromISO(storedDate), 'days').days);
  return named.reduce((best, event) => (distance(event.date as string) < distance(best.date as string) ? event : best));
}

/** The posts that go out before the window opens. Pure. */
export function postsBeforeWindow<T extends { scheduled_for: string }>(posts: readonly T[], window: PromotionWindow | null): T[] {
  return posts.filter((post) => beforePromotionWindow(londonDate(post.scheduled_for), window));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The owner's notice: the event, how many posts, from when it may be promoted, and why. */
export function orderNotice(eventName: string, window: PromotionWindow, early: readonly { scheduled_for: string }[]): {
  title: string;
  body: string;
} {
  const count = early.length;
  const days = [...new Set(early.map((post) => londonDate(post.scheduled_for)))].sort().map((day) => formatEventDateLong(day));
  return {
    title: `${eventName}: ${count} scheduled ${plural(count, 'post goes', 'posts go')} out before ${formatEventDateLong(window.opensOn)}, when its promotion may start. Move or delete ${plural(count, 'it', 'them')} in the planner.`,
    body: `${promotionWindowMessage(eventName, window)} Posts too early: ${days.join(', ')}.`,
  };
}

/**
 * Check one brand's scheduled event posts. Throws when its posts or the events system cannot be
 * read, so the cron can report a failed check instead of a clean one.
 */
export async function checkAccountEventOrder(
  {
    db,
    accountId,
    config,
    now = new Date(),
  }: { db: SupabaseClient; accountId: string; config: ManagementApiConfig; now?: Date },
  deps: EventOrderDeps = DEFAULT_DEPS,
): Promise<EventOrderSummary> {
  const { data, error } = await db
    .from('content_items')
    .select(
      'id, campaign_id, scheduled_for, event_name:prompt_context->brief->>eventName, event_date:prompt_context->brief->>eventDate, category:prompt_context->brief->facts->>category',
    )
    .eq('account_id', accountId)
    .eq('content_type', 'event')
    .eq('status', 'scheduled')
    .is('deleted_at', null)
    .gt('scheduled_for', now.toISOString())
    .order('scheduled_for')
    .limit(1000)
    .returns<ScheduledEventPostRow[]>();
  if (error) throw new Error(`scheduled event posts could not be read: ${error.message}`);

  const groups = new Map<string, ScheduledEventPostRow[]>();
  for (const row of data ?? []) {
    if (!row.event_name?.trim()) continue;
    const key = row.campaign_id ?? `${normalise(row.event_name)}|${row.event_date ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const summary: EventOrderSummary = { campaigns: groups.size, posts: 0, flagged: 0, notified: 0 };
  for (const posts of groups.values()) {
    summary.posts += posts.length;
    const [first] = posts;
    const eventName = first.event_name!.trim();
    const event = findEvent(await deps.listEvents(config, { query: eventName, limit: 20 }), eventName, first.event_date);
    const eventDate = event?.date ?? first.event_date;
    if (!eventDate || !ISO_DATE.test(eventDate)) continue;

    const window = await deps.loadWindow(config, {
      eventId: event?.id,
      eventDate,
      categorySlug: event?.categorySlug ?? null,
      categoryName: event?.categoryName ?? first.category,
    });
    const early = postsBeforeWindow(posts, window);
    if (!window || !early.length) continue;

    summary.flagged += early.length;
    const notice = orderNotice(eventName, window, early);
    const result = await deps.notify({
      supabase: db,
      accountId,
      category: EVENT_ORDER_CATEGORY,
      title: notice.title,
      body: notice.body,
      resourceType: first.campaign_id ? 'campaign' : 'content_item',
      resourceId: first.campaign_id ?? early[0].id,
    });
    if (result.status === 'failed') throw new Error(`the owner could not be told: ${result.error}`);
    if (result.status === 'inserted') summary.notified += 1;
  }
  return summary;
}
