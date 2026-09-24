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
  subscription: { status: string; current_period_end: string | null } | null;
};

const writes: Array<{ table: string; op: string; payload: unknown; filters: Array<[string, unknown]> }> = [];

function mockSupabase(tables: Tables) {
  return {
    from: vi.fn((table: string) => {
      let op = 'select';
      let payload: unknown = null;
      const filters: Array<[string, unknown]> = [];
      const c: Record<string, unknown> = {};
      const chain = () => c;
      c.select = vi.fn(chain);
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
        if (table === 'subscriptions') return { data: tables.subscription, error: null };
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(await worker({ flag: { enabled: true }, account: plain, subscription: { status: 'past_due', current_period_end: '2026-10-10T00:00:00Z' } }).checkHold('brand-1', NOW)).toBeNull();
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
