import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase/functions/publish-queue/tournament-freshness', () => ({ legacyTournamentContentIssue: vi.fn().mockResolvedValue(null) }));

import { PublishQueueWorker, createDefaultConfig } from '../supabase/functions/publish-queue/worker';

/**
 * Billing hold in the live publish worker (spec §4.2). A brand that may not
 * publish has its due job held before any provider call; nothing is held while
 * the billing_enforcement switch is off.
 */

type Tables = {
  flag: { enabled: boolean } | null;
  flagError?: unknown;
  account: { archived_at: string | null; billing_override: 'comped' | 'suspended' | null } | null;
  subscription: { status: string; current_period_start?: string | null; current_period_end: string | null } | null;
  /** Simulate the function running before migration 20260926120000 added current_period_start. */
  periodStartColumnMissing?: boolean;
};

const writes: Array<{ table: string; op: string; payload: unknown; filters: Array<[string, unknown]> }> = [];
const subscriptionSelects: string[] = [];

function mockSupabase(tables: Tables) {
  return {
    from: vi.fn((table: string) => {
      let op = 'select';
      let payload: unknown = null;
      let columns = '';
      const filters: Array<[string, unknown]> = [];
      const c: Record<string, unknown> = {};
      const chain = () => c;
      c.select = vi.fn((cols?: string) => {
        columns = cols ?? '*';
        if (table === 'subscriptions') subscriptionSelects.push(columns);
        return c;
      });
      c.order = vi.fn(chain);
      c.limit = vi.fn(chain);
      c.lte = vi.fn(chain);
      c.eq = vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return c;
      });
      c.update = vi.fn((p: unknown) => {
        op = 'update';
        payload = p;
        return c;
      });
      c.insert = vi.fn(async (p: unknown) => {
        writes.push({ table, op: 'insert', payload: p, filters: [] });
        return { error: null };
      });
      c.maybeSingle = vi.fn(async () => {
        if (op === 'update') {
          writes.push({ table, op, payload, filters });
          return { data: { id: 'job-1' }, error: null };
        }
        if (table === 'app_flags') return { data: tables.flag, error: tables.flagError ?? null };
        if (table === 'accounts') return { data: tables.account, error: null };
        if (table === 'subscriptions') {
          if (tables.periodStartColumnMissing && columns.includes('current_period_start')) {
            return { data: null, error: { code: '42703', message: 'column subscriptions.current_period_start does not exist' } };
          }
          if (!tables.subscription) return { data: null, error: null };
          // Return only the selected columns, as PostgREST would.
          const picked = Object.fromEntries(
            columns.split(',').map((name) => name.trim()).map((name) => [name, (tables.subscription as Record<string, unknown>)[name] ?? null]),
          );
          return { data: picked, error: null };
        }
        if (table === 'content_items') {
          return {
            data: { id: 'content-1', account_id: 'brand-1', platform: 'facebook', placement: 'feed', scheduled_for: '2026-10-15T09:00:00Z', prompt_context: null, campaigns: null },
            error: null,
          };
        }
        return { data: null, error: null };
      });
      c.then = (resolve: (v: unknown) => unknown) => {
        if (op === 'update') writes.push({ table, op, payload, filters });
        return resolve({ data: null, error: null });
      };
      return c;
    }),
  };
}

class HoldTestWorker extends PublishQueueWorker {
  publishByPlatform = vi.fn();
  async recoverStuckJobs() {}
  protected async recordHeartbeat() {}
  checkHold(accountId: string, now: Date) {
    return this.checkPublishHold(accountId, now);
  }
}

const NOW = new Date('2026-10-15T09:00:00Z');
const JOB = { id: 'job-1', content_item_id: 'content-1', status: 'queued', next_attempt_at: '2026-10-15T09:00:00Z', attempt: 0, placement: 'feed' as const, variant_id: 'variant-1' };
const plain = { archived_at: null, billing_override: null };

function worker(tables: Tables) {
  return new HoldTestWorker(createDefaultConfig(), mockSupabase(tables) as never);
}

beforeEach(() => {
  writes.length = 0;
  subscriptionSelects.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {}).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {}).mockClear();
});

describe('checkPublishHold', () => {
  it('holds nothing while billing enforcement is off', async () => {
    expect(await worker({ flag: { enabled: false }, account: plain, subscription: null }).checkHold('brand-1', NOW)).toBeNull();
    expect(await worker({ flag: null, account: plain, subscription: null }).checkHold('brand-1', NOW)).toBeNull();
  });

  it('holds lapsed, unset-up and suspended brands when on', async () => {
    expect(await worker({ flag: { enabled: true }, account: plain, subscription: { status: 'canceled', current_period_end: null } }).checkHold('brand-1', NOW)).toBe('lapsed');
    expect(await worker({ flag: { enabled: true }, account: plain, subscription: null }).checkHold('brand-1', NOW)).toBe('incomplete');
    expect(await worker({ flag: { enabled: true }, account: { archived_at: null, billing_override: 'suspended' }, subscription: null }).checkHold('brand-1', NOW)).toBe('suspended');
  });

  it('lets comped, paying, trialing and in-grace brands publish', async () => {
    expect(await worker({ flag: { enabled: true }, account: { archived_at: null, billing_override: 'comped' }, subscription: null }).checkHold('brand-1', NOW)).toBeNull();
    expect(await worker({ flag: { enabled: true }, account: plain, subscription: { status: 'active', current_period_end: null } }).checkHold('brand-1', NOW)).toBeNull();
    expect(await worker({ flag: { enabled: true }, account: plain, subscription: { status: 'trialing', current_period_end: null } }).checkHold('brand-1', NOW)).toBeNull();
    expect(
      await worker({
        flag: { enabled: true },
        account: plain,
        subscription: { status: 'past_due', current_period_start: '2026-10-09T09:00:00Z', current_period_end: '2026-11-09T09:00:00Z' },
      }).checkHold('brand-1', NOW),
    ).toBeNull();
  });

  it('measures past-due grace from the start of the unpaid period, not the (future) period end', async () => {
    // NOW is 2026-10-15T09:00Z. Stripe has moved the period on to 2026-11-07 before the payment failed.
    const unpaidSince = (start: string) =>
      worker({ flag: { enabled: true }, account: plain, subscription: { status: 'past_due', current_period_start: start, current_period_end: '2026-11-07T09:00:00Z' } });
    expect(await unpaidSince('2026-10-07T09:00:00Z').checkHold('brand-1', NOW)).toBe('lapsed');
    expect(await unpaidSince('2026-10-09T09:00:00Z').checkHold('brand-1', NOW)).toBeNull();
    expect(subscriptionSelects[0]).toBe('status, current_period_start, current_period_end');
  });

  it('still works before the period-start column exists: reads the old columns and uses the period end', async () => {
    const legacy = (periodEnd: string) =>
      worker({
        flag: { enabled: true },
        account: plain,
        subscription: { status: 'past_due', current_period_end: periodEnd },
        periodStartColumnMissing: true,
      });
    expect(await legacy('2026-10-10T00:00:00Z').checkHold('brand-1', NOW)).toBeNull();
    expect(subscriptionSelects).toEqual(['status, current_period_start, current_period_end', 'status, current_period_end']);
    expect(await legacy('2026-10-01T00:00:00Z').checkHold('brand-1', NOW)).toBe('lapsed');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('publishes (and logs) when the check itself fails, so a read error never stops every brand', async () => {
    expect(await worker({ flag: null, flagError: { message: 'db down' }, account: plain, subscription: null }).checkHold('brand-1', NOW)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('handleJob with a held brand', () => {
  it('holds the job before any provider call and tells the brand', async () => {
    const w = worker({ flag: { enabled: true }, account: plain, subscription: { status: 'unpaid', current_period_end: null } });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      await w.handleJob(JOB);
    } finally {
      vi.useRealTimers();
    }

    expect(w.publishByPlatform).not.toHaveBeenCalled();
    const hold = writes.find((write) => write.table === 'publish_jobs' && (write.payload as { status?: string })?.status === 'held');
    expect(hold?.payload).toMatchObject({ status: 'held', hold_reason: 'entitlement', attempt: 0 });
    expect((hold?.payload as { last_error: string }).last_error).toMatch(/^On hold: this brand's subscription has lapsed/);
    expect(hold?.filters).toContainEqual(['id', 'job-1']);
    const notification = writes.find((write) => write.table === 'notifications');
    expect(notification?.payload).toMatchObject({ account_id: 'brand-1', category: 'publish_held' });
  });
});
