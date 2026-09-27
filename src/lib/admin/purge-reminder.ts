import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { env } from '@/env';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { sendEmail } from '@/lib/email/resend';
import { formatUkLongDate } from '@/lib/utils/date';

/**
 * Daily operator reminder for offboarded brands whose 30-day hold is over
 * (docs/runbooks/customer-offboarding.md). Deletion stays manual (Peter's
 * decision, 27 September 2026): this only tells the operator which brands are
 * due, so the privacy notice's "deleted after 30 days" stays true. Sends
 * nothing when no brand is due.
 */

export interface BrandDueForDeletion {
  accountId: string;
  name: string;
  offboardedAt: string;
  purgeAfter: string;
  /** Whole London calendar days since purge_after; 0 means it became due today. */
  daysOverdue: number;
}

export interface PurgeReminderResult {
  due: number;
  sent: boolean;
}

interface OffboardedAccountRow {
  id: string;
  business_name: string | null;
  offboarded_at: string;
  purge_after: string;
}

/** Calendar days between two instants on the London calendar (DST-safe). */
function londonDaysBetween(from: string, now: Date): number {
  const start = DateTime.fromISO(from, { zone: DEFAULT_TIMEZONE }).startOf('day');
  const today = DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE }).startOf('day');
  return Math.max(0, Math.round(today.diff(start, 'days').days));
}

/** Every brand that is offboarded, past its purge date and not yet deleted, most overdue first. */
export async function findBrandsDueForDeletion(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<BrandDueForDeletion[]> {
  // Operator view across every brand, so deliberately not scoped to one account.
  const { data, error } = await service
    .from('accounts')
    .select('id, business_name, offboarded_at, purge_after')
    .not('offboarded_at', 'is', null)
    .not('purge_after', 'is', null)
    .lte('purge_after', now.toISOString())
    .order('purge_after', { ascending: true })
    .returns<OffboardedAccountRow[]>();
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    accountId: row.id,
    name: row.business_name?.trim() || row.id,
    offboardedAt: row.offboarded_at,
    purgeAfter: row.purge_after,
    daysOverdue: londonDaysBetween(row.purge_after, now),
  }));
}

/** "31 August 2026"; throws rather than render a blank or broken date. */
function longDate(value: string): string {
  const formatted = formatUkLongDate(value);
  if (!formatted) throw new Error(`Cannot render date "${value}" in the purge reminder.`);
  return formatted;
}

function overdueLabel(days: number): string {
  if (!Number.isFinite(days)) throw new Error('Cannot render the days overdue in the purge reminder.');
  if (days === 0) return 'due today';
  return days === 1 ? '1 day overdue' : `${days} days overdue`;
}

/** Subject and HTML for the reminder. Pure, so tests can render it with fixtures. */
export function renderPurgeReminderEmail(
  brands: BrandDueForDeletion[],
  siteUrl: string,
): { subject: string; html: string } {
  const adminUrl = `${siteUrl.replace(/\/+$/, '')}/admin#offboarding`;
  const count = brands.length;
  const subject =
    count === 1
      ? '[Cheers operator] 1 offboarded brand is due for deletion'
      : `[Cheers operator] ${count} offboarded brands are due for deletion`;

  const items = brands
    .map(
      (brand) =>
        `<li><strong>${escapeHtml(brand.name)}</strong>: offboarded ${longDate(brand.offboardedAt)}, ` +
        `deletion allowed from ${longDate(brand.purgeAfter)}, ${overdueLabel(brand.daysOverdue)}.</li>`,
    )
    .join('\n');

  const html = `
<p>${count === 1 ? 'This offboarded brand has' : 'These offboarded brands have'} passed the 30-day hold and ${count === 1 ? 'its' : 'their'} data has not been deleted yet.</p>
<ul>
${items}
</ul>
<p>Deletion is manual. Open <a href="${escapeHtml(adminUrl)}">Admin, Offboarding</a>, choose the brand and use <strong>Delete data</strong>, following docs/runbooks/customer-offboarding.md.</p>
<p>You will get this email every day until each brand listed is deleted.</p>
`.trim();

  return { subject, html };
}

/** Email the operator the list of brands due for deletion, or do nothing when none are due. */
export async function sendPurgeReminder(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<PurgeReminderResult> {
  const brands = await findBrandsDueForDeletion(service, now);
  if (brands.length === 0) return { due: 0, sent: false };

  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set; cannot send the purge reminder.');

  const { subject, html } = renderPurgeReminderEmail(brands, env.client.NEXT_PUBLIC_SITE_URL);
  // required: a missing Resend config throws instead of skipping, so the cron fails visibly.
  await sendEmail({ to, subject, html, required: true });
  return { due: brands.length, sent: true };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
