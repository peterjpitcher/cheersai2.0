import { describe, expect, it, vi } from 'vitest';

import { releaseHeldPublishJobs } from '@/lib/billing/publish-hold';

function service(released: unknown[], stillHeld: number) {
  const calls: Array<{ op: string; payload?: unknown; filters: Array<[string, string, unknown]> }> = [];
  return {
    calls,
    from: vi.fn(() => {
      const entry: { op: string; payload?: unknown; filters: Array<[string, string, unknown]> } = { op: 'select', filters: [] };
      calls.push(entry);
      const c: Record<string, unknown> = {};
      c.update = vi.fn((payload: unknown) => {
        entry.op = 'update';
        entry.payload = payload;
        return c;
      });
      c.select = vi.fn(() => c);
      for (const m of ['eq', 'gt']) {
        c[m] = vi.fn((column: string, value: unknown) => {
          entry.filters.push([m, column, value]);
          return c;
        });
      }
      c.then = (resolve: (v: unknown) => unknown) =>
        resolve(entry.op === 'update' ? { data: released, error: null } : { count: stillHeld, error: null });
      return c;
    }),
  };
}

describe('releaseHeldPublishJobs', () => {
  it('requeues only future held posts of this brand and leaves overdue ones for review', async () => {
    const db = service([{ id: 'j1' }, { id: 'j2' }], 1);
    const now = new Date('2026-10-15T12:00:00Z');

    expect(await releaseHeldPublishJobs(db as never, 'brand-1', now)).toEqual({ released: 2, stillHeld: 1 });

    const update = db.calls.find((call) => call.op === 'update')!;
    expect(update.payload).toMatchObject({ status: 'queued', hold_reason: null, last_error: null });
    expect(update.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'account_id', 'brand-1'],
        ['eq', 'status', 'held'],
        ['eq', 'hold_reason', 'entitlement'],
        ['gt', 'next_attempt_at', '2026-10-15T12:00:00.000Z'],
      ]),
    );
  });
});
