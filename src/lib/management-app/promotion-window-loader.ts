import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { listManagementEvents, type ManagementApiConfig } from '@/lib/management-app/client';
import { promotionWindowFrom, type PromotionWindow, type WindowTarget } from '@/lib/management-app/promotion-window';

/** How far back to look for the last event of the same type (about four monthly cycles). */
const LOOKBACK_DAYS = 120;

/**
 * Look up an event's promotion window in the management app: the events of
 * the 120 days before it, then promotionWindowFrom. Null when the event has no
 * category or no earlier event of its type.
 */
export async function loadPromotionWindow(config: ManagementApiConfig, target: WindowTarget): Promise<PromotionWindow | null> {
  if (!target.categorySlug?.trim() && !target.categoryName?.trim()) return null;
  const eventDay = DateTime.fromISO(target.eventDate, { zone: DEFAULT_TIMEZONE });
  if (!eventDay.isValid) return null;
  const events = await listManagementEvents(config, {
    fromDate: eventDay.minus({ days: LOOKBACK_DAYS }).toISODate() ?? undefined,
    toDate: eventDay.minus({ days: 1 }).toISODate() ?? undefined,
    limit: 100,
  });
  return promotionWindowFrom(events, target);
}
