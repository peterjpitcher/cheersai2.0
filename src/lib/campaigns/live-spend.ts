import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';

/**
 * Counts the brand's Meta campaigns that can still spend. Disconnecting Meta
 * Ads and offboarding a brand both refuse while this is above zero, because
 * once the ads token is deleted the app could no longer pause them.
 *
 * A campaign can still spend when:
 * - either view says it is on: `status` is the app's view and `meta_status` is
 *   what Meta last reported, which differs when a campaign is switched back on
 *   in Ads Manager; and
 * - its end date has not passed. Rows stay ACTIVE after the end date (Meta
 *   stops delivery, the row is not updated), so only a campaign with no end
 *   date, or one ending today or later, counts. "Today" is the London calendar
 *   day: a campaign ending today still spends today, and at 00:30 BST one that
 *   ended yesterday no longer counts even though it is still yesterday in UTC.
 *
 * Always scoped to one account. Throws when the lookup fails, so callers fail
 * closed rather than deleting a token they could not check.
 */
export async function countCampaignsThatCanSpend(
  service: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<number> {
  const today = DateTime.fromJSDate(now).setZone(DEFAULT_TIMEZONE).toISODate();
  if (!today) throw new Error('meta_campaigns lookup failed: could not resolve today in London');

  // Two or() filters are ANDed by PostgREST: (either status is ACTIVE) AND (no end date or not yet ended).
  const { count, error } = await service
    .from('meta_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .or('status.eq.ACTIVE,meta_status.eq.ACTIVE')
    .or(`end_date.is.null,end_date.gte.${today}`);
  if (error) throw new Error(`meta_campaigns lookup failed: ${error.message}`);

  return count ?? 0;
}
