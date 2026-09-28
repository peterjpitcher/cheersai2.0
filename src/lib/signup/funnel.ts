import type { SupabaseClient } from '@supabase/supabase-js';

import { chunk, ID_CHUNK, londonDaysCutoff, readAll } from '@/lib/signup/digest';

// ---------------------------------------------------------------------------
// The self-serve sign-up funnel (tasks/SPEC-self-serve-signup.md §4.10) for
// the admin Sign-ups card. The same counts as the runbook's SQL
// (docs/runbooks/data-retention.md), worked out here through PostgREST so no
// migration is needed:
//
//   stored steps (self_serve_signups, one row per login, so a retry never
//   counts twice): asked, confirmed, venue created;
//   derived steps, using the setup checklist's rules: Checkout confirmed (the
//   brand has any subscriptions row), Facebook or Instagram connected
//   (social_connections active or expiring), first post published (a
//   content_items row with status 'posted').
//
// A row is in a window when it was asked for within the last N London
// calendar days, today included (midnight in London, so a 23- or 25-hour
// clock-change day counts as one day). The runbook's SQL uses a rolling
// 30 x 24 hours instead, so the two can differ by a few hours' sign-ups at
// the window's start.
//
// Operator view across every self-serve brand, so these reads are
// deliberately not scoped to one account (as in ./digest.ts). Nothing
// personal is read: ids and timestamps only.
// ---------------------------------------------------------------------------

/** The card's windows, in London calendar days (today included). */
export const FUNNEL_WINDOWS_DAYS = [7, 30, 90] as const;

export interface SignupFunnelCounts {
  requested: number;
  verified: number;
  venueCreated: number;
  checkoutConfirmed: number;
  channelConnected: number;
  firstPost: number;
}

export interface SignupFunnelWindow {
  days: number;
  /** First instant inside the window (midnight in London, as UTC). */
  since: string;
  counts: SignupFunnelCounts;
}

export interface SignupFunnel {
  windows: SignupFunnelWindow[];
}

interface SignupRow {
  account_id: string | null;
  requested_at: string;
  verified_at: string | null;
  venue_created_at: string | null;
}

/** Which of the given brands have at least one matching row, read page by page. */
async function accountsWith(
  label: string,
  ids: string[],
  query: (ids: string[], from: number, to: number) => PromiseLike<{ data: Array<{ account_id: string }> | null; error: { message: string } | null }>,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(ids, ID_CHUNK)) {
    const rows = await readAll(label, (from, to) => query(part, from, to));
    for (const row of rows) found.add(row.account_id);
  }
  return found;
}

export async function findSignupFunnel(
  service: SupabaseClient,
  now: Date = new Date(),
  windowsDays: readonly number[] = FUNNEL_WINDOWS_DAYS,
): Promise<SignupFunnel> {
  const windows = [...windowsDays].sort((a, b) => a - b).map((days) => ({ days, since: londonDaysCutoff(now, days) }));
  const widest = windows[windows.length - 1];
  if (!widest) return { windows: [] };

  const rows = await readAll<SignupRow>('self_serve_signups', (from, to) =>
    service
      .from('self_serve_signups')
      .select('account_id, requested_at, verified_at, venue_created_at')
      .gte('requested_at', widest.since)
      .order('requested_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
      .returns<SignupRow[]>(),
  );

  const accountIds = [...new Set(rows.map((row) => row.account_id).filter((id): id is string => Boolean(id)))];
  const [subscribed, connected, posted] = accountIds.length
    ? await Promise.all([
        accountsWith('subscriptions', accountIds, (ids, from, to) =>
          service
            .from('subscriptions')
            .select('account_id')
            .in('account_id', ids)
            .order('account_id', { ascending: true })
            .order('stripe_subscription_id', { ascending: true })
            .range(from, to)
            .returns<Array<{ account_id: string }>>(),
        ),
        accountsWith('social_connections', accountIds, (ids, from, to) =>
          service
            .from('social_connections')
            .select('account_id')
            .in('account_id', ids)
            .in('status', ['active', 'expiring'])
            .order('account_id', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
            .returns<Array<{ account_id: string }>>(),
        ),
        accountsWith('content_items', accountIds, (ids, from, to) =>
          service
            .from('content_items')
            .select('account_id')
            .in('account_id', ids)
            .eq('status', 'posted')
            .order('account_id', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
            .returns<Array<{ account_id: string }>>(),
        ),
      ])
    : [new Set<string>(), new Set<string>(), new Set<string>()];

  return {
    windows: windows.map(({ days, since }) => {
      const start = Date.parse(since);
      const inWindow = rows.filter((row) => Date.parse(row.requested_at) >= start);
      const has = (set: Set<string>) => inWindow.filter((row) => row.account_id !== null && set.has(row.account_id)).length;
      return {
        days,
        since,
        counts: {
          requested: inWindow.length,
          verified: inWindow.filter((row) => row.verified_at !== null).length,
          venueCreated: inWindow.filter((row) => row.venue_created_at !== null).length,
          checkoutConfirmed: has(subscribed),
          channelConnected: has(connected),
          firstPost: has(posted),
        },
      };
    }),
  };
}
