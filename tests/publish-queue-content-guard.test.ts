import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase/functions/publish-queue/tournament-freshness', () => ({ legacyTournamentContentIssue: vi.fn().mockResolvedValue(null) }));

import {
  CONTENT_NOT_PUBLISHABLE_CODE,
  PublishQueueWorker,
  createDefaultConfig,
  unpublishableContentReason,
} from '../supabase/functions/publish-queue/worker';

/**
 * The live publish worker only sends approved, live posts. A job armed for a
 * draft (the planner used to arm one when a draft's time changed), a deleted
 * post or an already published post is refused before any provider call, and
 * the post keeps its status.
 */

// Live rules for the columns the refusal writes (checked on nbkjciurhvkfpcpatbnt, 2026-09-27).
const PUBLISH_JOB_STATUSES = new Set(['queued', 'in_progress', 'succeeded', 'failed', 'held']);

type Write = { table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> };

const writes: Write[] = [];
const reads: string[] = [];

function mockSupabase(content: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => {
      let op = 'select';
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const c: Record<string, unknown> = {};
      const recordWrite = () => {
        if (table === 'publish_jobs') {
          if ('status' in payload && !PUBLISH_JOB_STATUSES.has(String(payload.status))) {
            return { data: null, error: { code: '23514', message: 'publish_jobs_status_check' } };
          }
          if ('attempt' in payload && payload.attempt === null) {
            return { data: null, error: { code: '23502', message: 'attempt is NOT NULL' } };
          }
        }
        writes.push({ table, payload, filters });
        return null;
      };
      c.select = vi.fn(() => c);
      c.eq = vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return c;
      });
      c.update = vi.fn((p: Record<string, unknown>) => {
        op = 'update';
        payload = p;
        return c;
      });
      c.insert = vi.fn(async (p: Record<string, unknown>) => {
        writes.push({ table, payload: p, filters: [] });
        return { error: null };
      });
      c.maybeSingle = vi.fn(async () => {
        if (op === 'update') {
          const rejected = recordWrite();
          if (rejected) return rejected;
          // The lock on the queued job.
          return { data: { id: 'job-1' }, error: null };
        }
        reads.push(table);
        if (table === 'content_items') return { data: content, error: null };
        return { data: null, error: null };
      });
      c.then = (resolve: (v: unknown) => unknown) => {
        if (op === 'update') {
          const rejected = recordWrite();
          if (rejected) return resolve(rejected);
        }
        return resolve({ data: null, error: null });
      };
      return c;
    }),
  };
}

class GuardTestWorker extends PublishQueueWorker {
  publishByPlatform = vi.fn();
  checkPublishHold = vi.fn(async () => null);
}

const JOB = { id: 'job-1', content_item_id: 'content-1', status: 'queued', next_attempt_at: '2026-10-15T11:00:00Z', attempt: 0, placement: 'feed' as const, variant_id: 'variant-1' };

function contentRow(overrides: Record<string, unknown>) {
  return {
    id: 'content-1',
    account_id: 'brand-1',
    status: 'scheduled',
    deleted_at: null,
    platform: 'facebook',
    placement: 'feed',
    scheduled_for: '2026-10-15T11:00:00Z',
    prompt_context: null,
    campaigns: null,
    ...overrides,
  };
}

async function runJob(content: Record<string, unknown>) {
  const worker = new GuardTestWorker(createDefaultConfig(), mockSupabase(content) as never);
  await worker.handleJob(JOB);
  return worker;
}

beforeEach(() => {
  writes.length = 0;
  reads.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {}).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {}).mockClear();
});

describe('unpublishableContentReason', () => {
  it.each(['scheduled', 'queued', 'publishing'])('lets %s content publish', (status) => {
    expect(unpublishableContentReason({ status, deleted_at: null })).toBeNull();
  });

  it.each([
    ['draft', /still a draft\. Approve it/],
    ['posted', /already been published/],
    ['failed', /failed earlier\. Reschedule it/],
    ['archived', /is archived, not scheduled/],
  ])('refuses %s content', (status, message) => {
    expect(unpublishableContentReason({ status, deleted_at: null })).toMatch(message);
  });

  it('refuses deleted content whatever its status', () => {
    expect(unpublishableContentReason({ status: 'scheduled', deleted_at: '2026-10-14T09:00:00Z' })).toMatch(/was deleted/);
  });
});

describe('handleJob refuses content that may not be published', () => {
  it('never publishes an unapproved draft and leaves it a draft', async () => {
    const worker = await runJob(contentRow({ status: 'draft' }));

    expect(worker.publishByPlatform).not.toHaveBeenCalled();
    // Refused before the billing check, the variant and the connection are read.
    expect(worker.checkPublishHold).not.toHaveBeenCalled();
    expect(reads).toEqual(['content_items']);

    const refusal = writes.find((write) => write.table === 'publish_jobs' && write.payload.status === 'failed');
    expect(refusal?.payload).toMatchObject({
      status: 'failed',
      attempt: 0,
      error_code: CONTENT_NOT_PUBLISHABLE_CODE,
      next_attempt_at: null,
    });
    expect(refusal?.payload.error_message).toMatch(/still a draft/);
    expect(refusal?.payload.last_error).toBe(refusal?.payload.error_message);
    expect(refusal?.filters).toContainEqual(['id', 'job-1']);

    // The post itself is not touched: no status change, no failure notification.
    expect(writes.filter((write) => write.table === 'content_items')).toEqual([]);
    expect(writes.filter((write) => write.table === 'notifications')).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('refused job job-1'), expect.objectContaining({ status: 'draft' }));
  });

  it('never publishes a deleted post', async () => {
    const worker = await runJob(contentRow({ deleted_at: '2026-10-14T09:00:00Z' }));

    expect(worker.publishByPlatform).not.toHaveBeenCalled();
    const refusal = writes.find((write) => write.table === 'publish_jobs' && write.payload.status === 'failed');
    expect(refusal?.payload.error_message).toMatch(/was deleted/);
  });

  it('never publishes a post twice', async () => {
    const worker = await runJob(contentRow({ status: 'posted' }));

    expect(worker.publishByPlatform).not.toHaveBeenCalled();
    expect(writes.filter((write) => write.table === 'content_items')).toEqual([]);
  });

  it('carries on past the guard for a scheduled post', async () => {
    const worker = await runJob(contentRow({ status: 'scheduled' }));

    // Past the guard the worker goes on to the billing check and the variant.
    expect(worker.checkPublishHold).toHaveBeenCalledWith('brand-1', expect.any(Date));
    expect(reads).toContain('content_variants');
    expect(writes.some((write) => write.payload.error_code === CONTENT_NOT_PUBLISHABLE_CODE)).toBe(false);
  });
});
