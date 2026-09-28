import { describe, expect, it } from 'vitest';

import { releaseHeldPublishJobs } from '@/lib/billing/publish-hold';
import { InMemoryBillingDb } from '../../../tests/helpers/in-memory-billing-db';

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-15T12:00:00Z');
const FUTURE = '2026-10-20T09:00:00Z';
const PAST = '2026-10-10T09:00:00Z';

function post(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, account_id: BRAND, status, ...extra };
}

function heldJob(id: string, contentItemId: string | null, nextAttemptAt: string, accountId = BRAND) {
  return { id, account_id: accountId, content_item_id: contentItemId, status: 'held', hold_reason: 'entitlement', next_attempt_at: nextAttemptAt };
}

function statusOf(db: InMemoryBillingDb, id: string) {
  return db.rows('publish_jobs').find((row) => row.id === id)?.status;
}

describe('releaseHeldPublishJobs', () => {
  it('requeues future held posts that are approved, and leaves overdue ones held for review', async () => {
    const db = new InMemoryBillingDb();
    db.seed('content_items', [
      post('c1111111-1111-4111-8111-111111111111', 'scheduled'),
      post('c2222222-2222-4222-8222-222222222222', 'scheduled'),
    ]);
    db.seed('publish_jobs', [
      heldJob('a1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', FUTURE),
      heldJob('a2222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222222', PAST),
    ]);

    expect(await releaseHeldPublishJobs(db.client(), BRAND, NOW)).toEqual({ released: 1, stillHeld: 1 });
    expect(statusOf(db, 'a1111111-1111-4111-8111-111111111111')).toBe('queued');
    expect(statusOf(db, 'a2222222-2222-4222-8222-222222222222')).toBe('held');
    const released = db.rows('publish_jobs').find((row) => row.id === 'a1111111-1111-4111-8111-111111111111');
    expect(released).toMatchObject({ hold_reason: null, last_error: null });
  });

  it('keeps a draft\'s job held, so an offboarded brand coming back is not sent a failure email per draft', async () => {
    const db = new InMemoryBillingDb();
    db.seed('content_items', [
      post('c3333333-3333-4333-8333-333333333333', 'draft'),
      post('c4444444-4444-4444-8444-444444444444', 'scheduled', { deleted_at: '2026-10-01T00:00:00Z' }),
      post('c5555555-5555-4555-8555-555555555555', 'scheduled'),
    ]);
    db.seed('publish_jobs', [
      heldJob('a3333333-3333-4333-8333-333333333333', 'c3333333-3333-4333-8333-333333333333', FUTURE),
      heldJob('a4444444-4444-4444-8444-444444444444', 'c4444444-4444-4444-8444-444444444444', FUTURE),
      heldJob('a5555555-5555-4555-8555-555555555555', 'c5555555-5555-4555-8555-555555555555', FUTURE),
      heldJob('a6666666-6666-4666-8666-666666666666', null, FUTURE),
    ]);

    expect(await releaseHeldPublishJobs(db.client(), BRAND, NOW)).toEqual({ released: 1, stillHeld: 3 });
    expect(statusOf(db, 'a5555555-5555-4555-8555-555555555555')).toBe('queued');
    expect(statusOf(db, 'a3333333-3333-4333-8333-333333333333')).toBe('held');
    expect(statusOf(db, 'a4444444-4444-4444-8444-444444444444')).toBe('held');
    expect(statusOf(db, 'a6666666-6666-4666-8666-666666666666')).toBe('held');
  });

  it('never touches another brand\'s posts', async () => {
    const db = new InMemoryBillingDb();
    db.seed('content_items', [{ id: 'c7777777-7777-4777-8777-777777777777', account_id: OTHER, status: 'scheduled' }]);
    db.seed('publish_jobs', [heldJob('a7777777-7777-4777-8777-777777777777', 'c7777777-7777-4777-8777-777777777777', FUTURE, OTHER)]);

    expect(await releaseHeldPublishJobs(db.client(), BRAND, NOW)).toEqual({ released: 0, stillHeld: 0 });
    expect(statusOf(db, 'a7777777-7777-4777-8777-777777777777')).toBe('held');
  });

  it('releases in batches when a brand has many held posts', async () => {
    const db = new InMemoryBillingDb();
    const ids = Array.from({ length: 250 }, (_, i) => i.toString(16).padStart(12, '0'));
    db.seed('content_items', ids.map((suffix) => post(`c0000000-0000-4000-8000-${suffix}`, 'scheduled')));
    db.seed('publish_jobs', ids.map((suffix) => heldJob(`a0000000-0000-4000-8000-${suffix}`, `c0000000-0000-4000-8000-${suffix}`, FUTURE)));

    expect(await releaseHeldPublishJobs(db.client(), BRAND, NOW)).toEqual({ released: 250, stillHeld: 0 });
    const inFilters = db.queries.filter((query) => query.table === 'publish_jobs' && query.op === 'update');
    expect(inFilters.length).toBe(3);
  });

  it('fails loudly when the held posts cannot be read', async () => {
    const db = new InMemoryBillingDb();
    db.seed('content_items', [post('c8888888-8888-4888-8888-888888888888', 'scheduled')]);
    db.seed('publish_jobs', [heldJob('a8888888-8888-4888-8888-888888888888', 'c8888888-8888-4888-8888-888888888888', FUTURE)]);
    db.fail('content_items', 'select');

    await expect(releaseHeldPublishJobs(db.client(), BRAND, NOW)).rejects.toThrow(/read held posts failed/);
    expect(statusOf(db, 'a8888888-8888-4888-8888-888888888888')).toBe('held');
  });
});
