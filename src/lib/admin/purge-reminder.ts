import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { env } from '@/env';
import { isLiveSubscriptionStatus } from '@/lib/billing/entitlement';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { sendEmail } from '@/lib/email/resend';
import { createLogger } from '@/lib/logging';
import { findSignupDigest, renderSignupDigestSections, signupDigestSize, type SignupDigest } from '@/lib/signup/digest';
import { formatUkLongDate } from '@/lib/utils/date';

/**
 * Daily operator reminder (docs/runbooks/customer-offboarding.md). Closing and
 * deleting stay manual (Peter's decisions, 27 September 2026); this only tells
 * the operator what is waiting, so the privacy notice stays true:
 *
 * 1. Offboarded brands whose 30-day hold is over and whose data has not been
 *    deleted yet.
 * 2. Brands whose subscription ended at least 90 days ago and that nobody has
 *    closed (decision L8). Brands with a billing override (comped or
 *    suspended) are left out: setting one is how the operator keeps a lapsed
 *    brand on purpose.
 * 3. The self-serve sign-up lists (src/lib/signup/digest.ts, spec §4.9, P7):
 *    sign-up problems in the last 24 hours, stuck sign-ups and venues that
 *    never started a plan. If they cannot be read, the email says so instead
 *    (and still carries lists 1 and 2); that never stops the reminder.
 *
 * Sends nothing when no list has anything in it.
 */

/** Days after a subscription ends before the brand is listed for review. */
export const LAPSED_REVIEW_DAYS = 90;

/** Supabase caps a read at 1,000 rows, so reads page through in blocks this size. */
const PAGE = 1000;

export interface BrandDueForDeletion {
  accountId: string;
  name: string;
  offboardedAt: string;
  purgeAfter: string;
  /** Whole London calendar days since purge_after; 0 means it became due today. */
  daysOverdue: number;
}

export interface LapsedBrand {
  accountId: string;
  name: string;
  /** When its last subscription ended (see subscriptionEndedAt). */
  endedAt: string;
  /** Whole London calendar days since endedAt; at least LAPSED_REVIEW_DAYS. */
  daysSinceEnded: number;
}

export interface OperatorReminder {
  dueForDeletion: BrandDueForDeletion[];
  lapsed: LapsedBrand[];
  /** The sign-up lists; absent or null when there is nothing to add. */
  signup?: SignupDigest | null;
  /** Set when the sign-up lists could not be read. */
  signupError?: string | null;
}

export interface PurgeReminderResult {
  due: number;
  lapsed: number;
  sent: boolean;
  /** Items in the sign-up lists (only when there were any). */
  signup?: number;
  /** Why the sign-up lists could not be read (only when they could not). */
  signupError?: string;
}

const logger = createLogger('data-retention');

interface OffboardedAccountRow {
  id: string;
  business_name: string | null;
  offboarded_at: string;
  purge_after: string;
}

interface SubscriptionRow {
  account_id: string;
  status: string;
  canceled_at: string | null;
  current_period_end: string | null;
  updated_at: string;
}

interface LapsedAccountRow {
  id: string;
  business_name: string | null;
}

/** Calendar days between two instants on the London calendar (DST-safe). */
function londonDaysBetween(from: string, now: Date): number {
  const start = DateTime.fromISO(from, { zone: DEFAULT_TIMEZONE }).startOf('day');
  const today = DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE }).startOf('day');
  return Math.max(0, Math.round(today.diff(start, 'days').days));
}

function brandName(row: { id: string; business_name: string | null }): string {
  return row.business_name?.trim() || row.id;
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
    name: brandName(row),
    offboardedAt: row.offboarded_at,
    purgeAfter: row.purge_after,
    daysOverdue: londonDaysBetween(row.purge_after, now),
  }));
}

function latest(values: Array<string | null>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Best stored estimate of when an ended subscription stopped. Stripe's
 * canceled_at is the time of the cancel request, which for a cancel at period
 * end comes before the period ends, so the later of the two is used; either
 * way the brand is listed no earlier than it should be. Rows with neither date
 * fall back to their last update.
 */
export function subscriptionEndedAt(row: Pick<SubscriptionRow, 'canceled_at' | 'current_period_end' | 'updated_at'>): string {
  return latest([row.canceled_at, row.current_period_end]) ?? row.updated_at;
}

async function fetchAllSubscriptions(service: SupabaseClient): Promise<SubscriptionRow[]> {
  const rows: SubscriptionRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    // Operator view across every brand, so deliberately not scoped to one account.
    const { data, error } = await service
      .from('subscriptions')
      .select('account_id, status, canceled_at, current_period_end, updated_at')
      .order('account_id', { ascending: true })
      .order('stripe_subscription_id', { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<SubscriptionRow[]>();
    if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/**
 * Brands whose subscriptions have all ended, the last at least
 * LAPSED_REVIEW_DAYS London days ago, that are not offboarded and have no
 * billing override. Longest lapsed first.
 */
export async function findLapsedBrands(service: SupabaseClient, now: Date = new Date()): Promise<LapsedBrand[]> {
  const byAccount = new Map<string, SubscriptionRow[]>();
  for (const row of await fetchAllSubscriptions(service)) {
    const list = byAccount.get(row.account_id) ?? [];
    list.push(row);
    byAccount.set(row.account_id, list);
  }

  const endedAtByAccount = new Map<string, string>();
  for (const [accountId, subscriptions] of byAccount) {
    if (subscriptions.some((subscription) => isLiveSubscriptionStatus(subscription.status))) continue;
    const endedAt = latest(subscriptions.map(subscriptionEndedAt));
    if (endedAt && londonDaysBetween(endedAt, now) >= LAPSED_REVIEW_DAYS) endedAtByAccount.set(accountId, endedAt);
  }
  if (endedAtByAccount.size === 0) return [];

  const { data, error } = await service
    .from('accounts')
    .select('id, business_name')
    .in('id', [...endedAtByAccount.keys()])
    .is('offboarded_at', null)
    .is('billing_override', null)
    .returns<LapsedAccountRow[]>();
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);

  return (data ?? [])
    .map((row) => {
      const endedAt = endedAtByAccount.get(row.id) as string;
      return { accountId: row.id, name: brandName(row), endedAt, daysSinceEnded: londonDaysBetween(endedAt, now) };
    })
    .sort((a, b) => b.daysSinceEnded - a.daysSinceEnded || a.name.localeCompare(b.name));
}

/** "31 August 2026"; throws rather than render a blank or broken date. */
function longDate(value: string): string {
  const formatted = formatUkLongDate(value);
  if (!formatted) throw new Error(`Cannot render date "${value}" in the operator reminder.`);
  return formatted;
}

function overdueLabel(days: number): string {
  if (!Number.isFinite(days)) throw new Error('Cannot render the days overdue in the operator reminder.');
  if (days === 0) return 'due today';
  return days === 1 ? '1 day overdue' : `${days} days overdue`;
}

function daysAgoLabel(days: number): string {
  if (!Number.isFinite(days)) throw new Error('Cannot render the days since the subscription ended in the operator reminder.');
  return `${days} days ago`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function signupSubjectParts({ signup, signupError }: OperatorReminder): string[] {
  const parts: string[] = [];
  if (signup) {
    const stuck = signup.verifiedWithoutVenue.length + signup.noCheckout.length + signup.trialWithoutConnection.length;
    if (signup.alerts.length > 0) parts.push(plural(signup.alerts.length, 'kind of sign-up problem', 'kinds of sign-up problem'));
    if (stuck > 0) parts.push(plural(stuck, 'stuck sign-up', 'stuck sign-ups'));
    if (signup.neverStarted.length > 0) parts.push(plural(signup.neverStarted.length, 'venue never started', 'venues never started'));
  }
  if (signupError) parts.push('sign-up lists unavailable');
  return parts;
}

function subjectFor(reminder: OperatorReminder): string {
  const { dueForDeletion, lapsed } = reminder;
  const signupParts = signupSubjectParts(reminder);
  if (signupParts.length > 0) {
    const parts = [
      ...(dueForDeletion.length > 0 ? [plural(dueForDeletion.length, 'brand due for deletion', 'brands due for deletion')] : []),
      ...(lapsed.length > 0 ? [plural(lapsed.length, 'lapsed brand to review', 'lapsed brands to review')] : []),
      ...signupParts,
    ];
    return `[Cheers operator] ${parts.join(', ')}`;
  }
  const due = dueForDeletion.length;
  const lapsedCount = lapsed.length;
  if (due > 0 && lapsedCount > 0) {
    return `[Cheers operator] ${plural(due, 'brand', 'brands')} due for deletion, ${plural(lapsedCount, 'lapsed brand', 'lapsed brands')} to review`;
  }
  if (due > 0) {
    return due === 1
      ? '[Cheers operator] 1 offboarded brand is due for deletion'
      : `[Cheers operator] ${due} offboarded brands are due for deletion`;
  }
  return lapsedCount === 1
    ? `[Cheers operator] 1 brand has had no subscription for ${LAPSED_REVIEW_DAYS} days`
    : `[Cheers operator] ${lapsedCount} brands have had no subscription for ${LAPSED_REVIEW_DAYS} days`;
}

/** Subject and HTML for the reminder. Pure, so tests can render it with fixtures. */
export function renderPurgeReminderEmail(
  reminder: OperatorReminder,
  siteUrl: string,
): { subject: string; html: string } {
  const adminUrl = escapeHtml(`${siteUrl.replace(/\/+$/, '')}/admin#offboarding`);
  const { dueForDeletion, lapsed } = reminder;
  const sections: string[] = [];

  if (dueForDeletion.length > 0) {
    const one = dueForDeletion.length === 1;
    const items = dueForDeletion
      .map(
        (brand) =>
          `<li><strong>${escapeHtml(brand.name)}</strong>: offboarded ${longDate(brand.offboardedAt)}, ` +
          `deletion allowed from ${longDate(brand.purgeAfter)}, ${overdueLabel(brand.daysOverdue)}.</li>`,
      )
      .join('\n');
    sections.push(`
<h3>Due for deletion</h3>
<p>${one ? 'This offboarded brand has' : 'These offboarded brands have'} passed the 30-day hold and ${one ? 'its' : 'their'} data has not been deleted yet.</p>
<ul>
${items}
</ul>
<p>Deletion is manual. Open <a href="${adminUrl}">Admin, Offboarding</a>, choose the brand and use <strong>Delete data</strong>, following docs/runbooks/customer-offboarding.md.</p>`);
  }

  if (lapsed.length > 0) {
    const one = lapsed.length === 1;
    const items = lapsed
      .map(
        (brand) =>
          `<li><strong>${escapeHtml(brand.name)}</strong>: subscription ended ${longDate(brand.endedAt)}, ${daysAgoLabel(brand.daysSinceEnded)}.</li>`,
      )
      .join('\n');
    sections.push(`
<h3>No subscription for ${LAPSED_REVIEW_DAYS} days</h3>
<p>${one ? "This brand's subscription" : "These brands' subscriptions"} ended at least ${LAPSED_REVIEW_DAYS} days ago and ${one ? 'it has' : 'they have'} not been closed.</p>
<ul>
${items}
</ul>
<p>If nobody has asked to keep ${one ? 'it' : 'them'}, open <a href="${adminUrl}">Admin, Offboarding</a>, choose the brand and use <strong>Offboard</strong>; the 30-day hold then starts. To keep a brand without a subscription, set its billing override to suspended and it stops appearing here.</p>`);
  }

  if (reminder.signup) sections.push(...renderSignupDigestSections(reminder.signup, siteUrl));
  if (reminder.signupError) {
    sections.push(`
<h3>Sign-up lists unavailable</h3>
<p>The self-serve sign-up lists (problems in the last 24 hours, stuck sign-ups, venues that never started) could not be read today: ${escapeHtml(reminder.signupError.slice(0, 300))}. Check admin_audit and self_serve_signups by hand, and the Vercel logs.</p>`);
  }

  const html = `${sections.map((section) => section.trim()).join('\n')}
<p>You will get this email every day until each brand listed is dealt with.</p>`;

  return { subject: subjectFor(reminder), html };
}

/** Email the operator what is waiting, or do nothing when nothing is. */
export async function sendPurgeReminder(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<PurgeReminderResult> {
  const dueForDeletion = await findBrandsDueForDeletion(service, now);
  const lapsed = await findLapsedBrands(service, now);

  let signup: SignupDigest | null = null;
  let signupError: string | null = null;
  try {
    const digest = await findSignupDigest(service, now);
    signup = signupDigestSize(digest) > 0 ? digest : null;
  } catch (error) {
    signupError = error instanceof Error ? error.message : String(error);
    logger.error('sign-up lists for the operator reminder could not be read', error instanceof Error ? error : undefined);
  }
  const signupCount = signup ? signupDigestSize(signup) : 0;

  const signupResult = {
    ...(signupCount > 0 ? { signup: signupCount } : {}),
    ...(signupError ? { signupError } : {}),
  };
  if (dueForDeletion.length === 0 && lapsed.length === 0 && signupCount === 0 && !signupError) {
    return { due: 0, lapsed: 0, sent: false };
  }

  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set; cannot send the operator reminder.');

  const { subject, html } = renderPurgeReminderEmail(
    { dueForDeletion, lapsed, signup, signupError },
    env.client.NEXT_PUBLIC_SITE_URL,
  );
  // required: a missing Resend config throws instead of skipping, so the cron fails visibly.
  await sendEmail({ to, subject, html, required: true });
  return { due: dueForDeletion.length, lapsed: lapsed.length, sent: true, ...signupResult };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
