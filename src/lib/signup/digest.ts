import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { formatUkDateTime, formatUkLongDate } from '@/lib/utils/date';

// ---------------------------------------------------------------------------
// The sign-up part of the daily operator email (tasks/SPEC-self-serve-
// signup.md §4.9, decision P7). The data-retention cron's operator reminder
// (src/lib/admin/purge-reminder.ts) adds these lists:
//
//   1. every operator_signup_alert row from the last 24 hours, by kind, so an
//      outage that also stopped the instant alert email still shows up the
//      next morning;
//   2. stuck sign-ups: confirmed (verified) for at least a day with no venue,
//      no brand and no open invitation (someone who joined or was invited to
//      a venue is not stuck); a venue at least 3 days old with no Checkout
//      (and less than 30 days old, when it moves to list 3); a trial at least
//      3 days old with no Facebook or Instagram connection;
//   3. never started (P7): a venue at least 30 days old that has never had a
//      subscription. The operator decides whether to close it.
//
// The lists are bounded so they cannot grow for ever (review of PR #146):
// confirmed logins are listed for 30 days (the clean-up deletes a confirmed
// login with no venue after 30 days anyway), venues for 90 days from creation
// (so a never-started venue is listed every day from day 30 to day 89: two
// months to decide, then it drops off).
//
// Day counts are London calendar days (Luxon), so a clock change never moves
// a venue from one list to another a day early or late. Only self-serve
// venues (a self_serve_signups row with a brand) are listed; brands made by
// the operator never appear. Nothing personal is listed: a login without a
// venue is shown by its id, a venue by its name. Operator view across every
// self-serve brand, so these reads are deliberately not scoped to one account.
// ---------------------------------------------------------------------------

export const STUCK_VERIFIED_DAYS = 1;
export const STUCK_NO_CHECKOUT_DAYS = 3;
export const STUCK_NO_CONNECTION_DAYS = 3;
export const NEVER_STARTED_DAYS = 30;
/** Confirmed logins with no venue are listed until they are this many London days old. */
export const VERIFIED_WINDOW_DAYS = 30;
/** Self-serve venues are listed until they are this many London days old. */
export const VENUE_WINDOW_DAYS = 90;
/** Longest list the email shows; the rest are counted. */
export const DIGEST_LIST_LIMIT = 50;

const PAGE = 1000;
/** Ids per .in() lookup, so a request URL stays short. Shared with the funnel (./funnel.ts). */
export const ID_CHUNK = 100;

export interface SignupAlertSummary {
  kind: string;
  /** operator_signup_alert rows for this kind in the last 24 hours. */
  rows: number;
  lastAt: string;
}

export interface VerifiedWithoutVenue {
  userId: string;
  verifiedAt: string;
  days: number;
}

export interface SelfServeVenueEntry {
  accountId: string;
  name: string;
  /** When the venue was created, or for a trial, when the trial's subscription was first recorded. */
  since: string;
  days: number;
}

export interface SignupDigest {
  alerts: SignupAlertSummary[];
  verifiedWithoutVenue: VerifiedWithoutVenue[];
  noCheckout: SelfServeVenueEntry[];
  trialWithoutConnection: SelfServeVenueEntry[];
  neverStarted: SelfServeVenueEntry[];
}

export function signupDigestSize(digest: SignupDigest): number {
  return (
    digest.alerts.length +
    digest.verifiedWithoutVenue.length +
    digest.noCheckout.length +
    digest.trialWithoutConnection.length +
    digest.neverStarted.length
  );
}

/** Whole London calendar days from an instant to now (DST-safe), never negative. */
export function londonDaysSince(from: string, now: Date): number {
  const start = DateTime.fromISO(from, { zone: DEFAULT_TIMEZONE }).startOf('day');
  const today = DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE }).startOf('day');
  if (!start.isValid || !today.isValid) return Number.NaN;
  return Math.max(0, Math.round(today.diff(start, 'days').days));
}

/**
 * The first instant that is less than N London calendar days before now: an
 * instant before it has londonDaysSince() >= N. Midnight in London, so a
 * 23- or 25-hour clock-change day counts as one day, like any other.
 */
export function londonDaysCutoff(now: Date, days: number): string {
  return DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE })
    .startOf('day')
    .minus({ days: days - 1 })
    .toUTC()
    .toISO() as string;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export type PagedQuery<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** A signal that never fires, for callers with no deadline (the daily email). */
export function noDeadline(): AbortSignal {
  return new AbortController().signal;
}

/** Throws once the caller's deadline has passed, so no further page or lookup is started. */
export function throwIfStopped(label: string, signal: AbortSignal): void {
  if (signal.aborted) throw new Error(`${label} lookup stopped: the deadline passed`);
}

/**
 * Reads every page of a query (PostgREST caps a response at 1,000 rows); the
 * query must have a stable order. Stops before the next page once the signal
 * fires (the query itself should also carry the signal, to cancel the request
 * in flight).
 */
export async function readAll<T>(label: string, query: PagedQuery<T>, signal: AbortSignal = noDeadline()): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    throwIfStopped(label, signal);
    const { data, error } = await query(offset, offset + PAGE - 1);
    if (error) throw new Error(`${label} lookup failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function findSignupAlerts(service: SupabaseClient, now: Date, signal: AbortSignal): Promise<SignupAlertSummary[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await readAll<{ detail: { kind?: unknown } | null; created_at: string }>(
    'admin_audit',
    (from, to) =>
      service
        .from('admin_audit')
        .select('detail, created_at')
        .eq('action', 'operator_signup_alert')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(from, to)
        .abortSignal(signal)
        .returns<Array<{ detail: { kind?: unknown } | null; created_at: string }>>(),
    signal,
  );
  const byKind = new Map<string, SignupAlertSummary>();
  for (const row of rows) {
    const kind = typeof row.detail?.kind === 'string' ? row.detail.kind : 'unknown';
    const summary = byKind.get(kind) ?? { kind, rows: 0, lastAt: row.created_at };
    summary.rows += 1;
    if (Date.parse(row.created_at) >= Date.parse(summary.lastAt)) summary.lastAt = row.created_at;
    byKind.set(kind, summary);
  }
  return [...byKind.values()].sort((a, b) => b.rows - a.rows || a.kind.localeCompare(b.kind));
}

interface AccountRow {
  id: string;
  business_name: string | null;
  archived_at: string | null;
  offboarded_at: string | null;
  billing_override: string | null;
}

interface SubscriptionRow {
  account_id: string;
  status: string;
  created_at: string;
}

export interface SignupReadOptions {
  /** Stops every read (in flight and not yet started) once it fires: the admin card's deadline. */
  signal?: AbortSignal;
}

export async function findSignupDigest(
  service: SupabaseClient,
  now: Date = new Date(),
  options: SignupReadOptions = {},
): Promise<SignupDigest> {
  const signal = options.signal ?? noDeadline();
  const alerts = await findSignupAlerts(service, now, signal);

  const verifiedCutoff = londonDaysCutoff(now, STUCK_VERIFIED_DAYS);
  const verifiedWindowStart = londonDaysCutoff(now, VERIFIED_WINDOW_DAYS);
  const verified = await readAll<{ user_id: string; verified_at: string }>(
    'self_serve_signups',
    (from, to) =>
      service
        .from('self_serve_signups')
        .select('user_id, verified_at')
        .not('user_id', 'is', null)
        .not('verified_at', 'is', null)
        .is('venue_created_at', null)
        .lt('verified_at', verifiedCutoff)
        .gte('verified_at', verifiedWindowStart)
        .order('verified_at', { ascending: true })
        .range(from, to)
        .abortSignal(signal)
        .returns<Array<{ user_id: string; verified_at: string }>>(),
    signal,
  );
  // Someone who has since joined a brand or been invited to one is not stuck.
  const settled = new Set<string>();
  const nowIso = now.toISOString();
  for (const ids of chunk(
    verified.map((row) => row.user_id),
    ID_CHUNK,
  )) {
    throwIfStopped('account_members', signal);
    const [members, invitations] = await Promise.all([
      service
        .from('account_members')
        .select('user_id')
        .in('user_id', ids)
        .abortSignal(signal)
        .returns<Array<{ user_id: string }>>(),
      service
        .from('team_invitations')
        .select('user_id')
        .in('user_id', ids)
        .is('accepted_at', null)
        .is('declined_at', null)
        .is('cancelled_at', null)
        .gt('expires_at', nowIso)
        .abortSignal(signal)
        .returns<Array<{ user_id: string }>>(),
    ]);
    if (members.error) throw new Error(`account_members lookup failed: ${members.error.message}`);
    if (invitations.error) throw new Error(`team_invitations lookup failed: ${invitations.error.message}`);
    for (const row of [...(members.data ?? []), ...(invitations.data ?? [])]) settled.add(row.user_id);
  }
  const verifiedWithoutVenue = verified
    .filter((row) => !settled.has(row.user_id))
    .map((row) => ({
      userId: row.user_id,
      verifiedAt: row.verified_at,
      days: londonDaysSince(row.verified_at, now),
    }));

  // Self-serve venues old enough for any venue list (3 days or more) and still inside the window.
  const venueCutoff = londonDaysCutoff(now, Math.min(STUCK_NO_CHECKOUT_DAYS, STUCK_NO_CONNECTION_DAYS));
  const venueWindowStart = londonDaysCutoff(now, VENUE_WINDOW_DAYS);
  const venues = await readAll<{ account_id: string; venue_created_at: string }>(
    'self_serve_signups',
    (from, to) =>
      service
        .from('self_serve_signups')
        .select('account_id, venue_created_at')
        .not('account_id', 'is', null)
        .lt('venue_created_at', venueCutoff)
        .gte('venue_created_at', venueWindowStart)
        .order('venue_created_at', { ascending: true })
        .range(from, to)
        .abortSignal(signal)
        .returns<Array<{ account_id: string; venue_created_at: string }>>(),
    signal,
  );
  if (venues.length === 0) {
    return { alerts, verifiedWithoutVenue, noCheckout: [], trialWithoutConnection: [], neverStarted: [] };
  }

  const accounts = new Map<string, AccountRow>();
  const subscriptions = new Map<string, SubscriptionRow[]>();
  const connected = new Set<string>();
  for (const ids of chunk(
    venues.map((venue) => venue.account_id),
    ID_CHUNK,
  )) {
    throwIfStopped('accounts', signal);
    const [accountRows, subscriptionRows, connectionRows] = await Promise.all([
      service
        .from('accounts')
        .select('id, business_name, archived_at, offboarded_at, billing_override')
        .in('id', ids)
        .abortSignal(signal)
        .returns<AccountRow[]>(),
      service
        .from('subscriptions')
        .select('account_id, status, created_at')
        .in('account_id', ids)
        .abortSignal(signal)
        .returns<SubscriptionRow[]>(),
      service
        .from('social_connections')
        .select('account_id')
        .in('account_id', ids)
        .in('status', ['active', 'expiring'])
        .abortSignal(signal)
        .returns<Array<{ account_id: string }>>(),
    ]);
    if (accountRows.error) throw new Error(`accounts lookup failed: ${accountRows.error.message}`);
    if (subscriptionRows.error) throw new Error(`subscriptions lookup failed: ${subscriptionRows.error.message}`);
    if (connectionRows.error) throw new Error(`social_connections lookup failed: ${connectionRows.error.message}`);
    for (const row of accountRows.data ?? []) accounts.set(row.id, row);
    for (const row of subscriptionRows.data ?? []) {
      const list = subscriptions.get(row.account_id) ?? [];
      list.push(row);
      subscriptions.set(row.account_id, list);
    }
    for (const row of connectionRows.data ?? []) connected.add(row.account_id);
  }

  const noCheckout: SelfServeVenueEntry[] = [];
  const trialWithoutConnection: SelfServeVenueEntry[] = [];
  const neverStarted: SelfServeVenueEntry[] = [];
  for (const venue of venues) {
    const account = accounts.get(venue.account_id);
    // A deleted, archived or offboarded brand, or one the operator set an override on, is dealt with.
    if (!account || account.archived_at || account.offboarded_at || account.billing_override) continue;
    const name = account.business_name?.trim() || account.id;
    const days = londonDaysSince(venue.venue_created_at, now);
    const subs = subscriptions.get(venue.account_id) ?? [];

    if (subs.length === 0) {
      const entry = { accountId: account.id, name, since: venue.venue_created_at, days };
      if (days >= NEVER_STARTED_DAYS) neverStarted.push(entry);
      else if (days >= STUCK_NO_CHECKOUT_DAYS) noCheckout.push(entry);
      continue;
    }

    const trial = subs
      .filter((sub) => sub.status === 'trialing')
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    if (trial && !connected.has(account.id)) {
      const trialDays = londonDaysSince(trial.created_at, now);
      if (trialDays >= STUCK_NO_CONNECTION_DAYS) {
        trialWithoutConnection.push({ accountId: account.id, name, since: trial.created_at, days: trialDays });
      }
    }
  }

  return { alerts, verifiedWithoutVenue, noCheckout, trialWithoutConnection, neverStarted };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function longDate(value: string): string {
  const formatted = formatUkLongDate(value);
  if (!formatted) throw new Error(`Cannot render date "${value}" in the sign-up digest.`);
  return formatted;
}

function dateTime(value: string): string {
  const formatted = formatUkDateTime(value);
  if (!formatted) throw new Error(`Cannot render time "${value}" in the sign-up digest.`);
  return formatted;
}

function daysAgo(days: number): string {
  if (!Number.isFinite(days)) throw new Error('Cannot render a day count in the sign-up digest.');
  if (days === 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function listItems<T>(items: T[], render: (item: T) => string): string {
  const shown = items.slice(0, DIGEST_LIST_LIMIT).map((item) => `<li>${render(item)}</li>`);
  if (items.length > DIGEST_LIST_LIMIT) shown.push(`<li>and ${items.length - DIGEST_LIST_LIMIT} more</li>`);
  return `<ul>\n${shown.join('\n')}\n</ul>`;
}

/**
 * Alert kinds where nobody was refused (src/lib/signup/alerts.ts), and what
 * happened instead. Every other kind refused the person with an error and our
 * email address.
 */
const NOT_REFUSED_KINDS: Readonly<Record<string, string>> = {
  venue_notice: 'Not refused: the venue was created and the owner went on to Billing; only its new-venue email to you or its admin_audit record failed.',
  closure_notice:
    "Not refused: the owner was told we have their request to close the venue, and the request email reached you; only its admin_audit record or the owner's confirmation email failed.",
  login_cleanup: 'Nobody was refused: the nightly clean-up could not delete some unused sign-up logins and tries again the next day.',
};

/** The digest's sections for the operator email; empty lists are left out. Pure, for fixture tests. */
export function renderSignupDigestSections(digest: SignupDigest, siteUrl: string): string[] {
  const adminUrl = escapeHtml(`${siteUrl.replace(/\/+$/, '')}/admin#offboarding`);
  const sections: string[] = [];

  if (digest.alerts.length > 0) {
    sections.push(`
<h3>Sign-up problems in the last 24 hours</h3>
<p>Failures recorded in admin_audit (operator_signup_alert), by kind. Unless a line says otherwise, each one was refused with an error and our email address. The Vercel logs have the detail.</p>
${listItems(digest.alerts, (alert) => {
  if (!Number.isFinite(alert.rows)) throw new Error('Cannot render an alert count in the sign-up digest.');
  const note = Object.hasOwn(NOT_REFUSED_KINDS, alert.kind) ? ` ${escapeHtml(NOT_REFUSED_KINDS[alert.kind] ?? '')}` : '';
  return `<strong>${escapeHtml(alert.kind)}</strong>: ${alert.rows === 1 ? '1 time' : `${alert.rows} times`}, last at ${dateTime(alert.lastAt)} (UK time).${note}`;
})}`);
  }

  const stuck: string[] = [];
  if (digest.verifiedWithoutVenue.length > 0) {
    stuck.push(`
<p>Confirmed their email at least ${STUCK_VERIFIED_DAYS} day ago but have not set up a venue (login id; no venue yet, so no name):</p>
${listItems(digest.verifiedWithoutVenue, (item) => `${escapeHtml(item.userId)}: confirmed ${longDate(item.verifiedAt)}, ${daysAgo(item.days)}.`)}`);
  }
  if (digest.noCheckout.length > 0) {
    stuck.push(`
<p>Set up a venue at least ${STUCK_NO_CHECKOUT_DAYS} days ago but have not started a plan through Checkout:</p>
${listItems(digest.noCheckout, (item) => `<strong>${escapeHtml(item.name)}</strong>: venue set up ${longDate(item.since)}, ${daysAgo(item.days)}.`)}`);
  }
  if (digest.trialWithoutConnection.length > 0) {
    stuck.push(`
<p>On a free trial for at least ${STUCK_NO_CONNECTION_DAYS} days with no Facebook or Instagram connected:</p>
${listItems(digest.trialWithoutConnection, (item) => `<strong>${escapeHtml(item.name)}</strong>: trial started ${longDate(item.since)}, ${daysAgo(item.days)}.`)}`);
  }
  if (stuck.length > 0) {
    sections.push(`
<h3>Stuck sign-ups</h3>
${stuck.map((part) => part.trim()).join('\n')}
<p>Nothing is done automatically. A friendly email from you may help them finish.</p>`);
  }

  if (digest.neverStarted.length > 0) {
    const one = digest.neverStarted.length === 1;
    sections.push(`
<h3>Never started a plan (${NEVER_STARTED_DAYS} days)</h3>
<p>${one ? 'This venue' : 'These venues'} signed up on ${one ? 'its' : 'their'} own at least ${NEVER_STARTED_DAYS} days ago and never started a subscription (decision P7):</p>
${listItems(digest.neverStarted, (item) => `<strong>${escapeHtml(item.name)}</strong>: venue set up ${longDate(item.since)}, ${daysAgo(item.days)}.`)}
<p>You decide whether to close ${one ? 'it' : 'them'}: open <a href="${adminUrl}">Admin, Offboarding</a> and use <strong>Offboard</strong>. To keep one, set its billing override and it stops appearing here.</p>`);
  }

  return sections.map((section) => section.trim());
}
