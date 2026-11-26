import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { listManagementEvents, type ManagementApiConfig } from '@/lib/management-app/client';
import { promotionWindowFrom, type PromotionWindow, type WindowTarget } from '@/lib/management-app/promotion-window';

/** How far back to look for the event before this one. */
const LOOKBACK_DAYS = 120;

/**
 * Look up an event's promotion window in the management app: the events of
 * the 120 days before it, then promotionWindowFrom. Null when no event comes
 * before it in that time.
 */
export async function loadPromotionWindow(config: ManagementApiConfig, target: WindowTarget): Promise<PromotionWindow | null> {
  const eventDay = DateTime.fromISO(target.eventDate, { zone: DEFAULT_TIMEZONE });
  if (!eventDay.isValid) return null;
  const events = await listManagementEvents(config, {
    fromDate: eventDay.minus({ days: LOOKBACK_DAYS }).toISODate() ?? undefined,
    toDate: eventDay.minus({ days: 1 }).toISODate() ?? undefined,
    limit: 100,
  });
  return promotionWindowFrom(events, target);
}
