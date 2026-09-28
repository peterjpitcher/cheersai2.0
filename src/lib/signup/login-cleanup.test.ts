import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteSelfServeLogins, parseSelfServeLoginList } from '@/lib/signup/login-cleanup';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Answer = { data?: unknown; count?: number | null; error: { message: string } | null };

function service(options: {
  signups?: Record<string, Answer>;
  members?: Record<string, Answer>;
  deleteErrors?: Record<string, { message: string }>;
}) {
  const deleteUser = vi.fn(async (id: string) => ({ data: {}, error: options.deleteErrors?.[id] ?? null }));
  const from = vi.fn((table: string) => {
    let userId = '';
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((_column: string, value: string) => {
      userId = value;
      return table === 'account_members'
        ? Promise.resolve(options.members?.[userId] ?? { count: 0, error: null })
        : chain;
    });
    chain.maybeSingle = vi.fn(async () =>
      options.signups?.[userId] ?? { data: { account_id: null, venue_created_at: null }, error: null },
    );
    return chain;
  });
  return { client: { from, auth: { admin: { deleteUser } } }, deleteUser };
}

const logger = { warn: vi.fn() };

beforeEach(() => {
  logger.warn.mockClear();
});

describe('parseSelfServeLoginList', () => {
  it('reads the list run_data_retention returns', () => {
    expect(parseSelfServeLoginList({ action: 'delete_login', due: 2, user_ids: [A, B], max_per_run: 100 })).toEqual({
      due: 2,
      userIds: [A, B],
    });
  });

  it('is undefined when the function predates the sign-up migration', () => {
    expect(parseSelfServeLoginList(undefined)).toBeUndefined();
  });

  it('is null for anything malformed, so the cron fails instead of guessing', () => {
    expect(parseSelfServeLoginList(null)).toBeNull();
    expect(parseSelfServeLoginList({ due: 1 })).toBeNull();
    expect(parseSelfServeLoginList({ due: '1', user_ids: [] })).toBeNull();
    expect(parseSelfServeLoginList({ due: 1, user_ids: ['not-a-uuid'] })).toBeNull();
  });
});

describe('deleteSelfServeLogins', () => {
  it('deletes each listed login through the Auth admin API', async () => {
    const { client, deleteUser } = service({});
    expect(await deleteSelfServeLogins(client as never, { due: 2, userIds: [A, B] }, logger)).toEqual({
      due: 2,
      deleted: 2,
      skipped: 0,
      failed: 0,
    });
    expect(deleteUser).toHaveBeenCalledWith(A);
    expect(deleteUser).toHaveBeenCalledWith(B);
  });

  it('leaves a login alone that created a venue or joined a brand after the list was made', async () => {
    const { client, deleteUser } = service({
      signups: { [A]: { data: { account_id: 'acc-1', venue_created_at: '2026-09-28T09:00:00Z' }, error: null } },
      members: { [B]: { count: 1, error: null } },
    });
    expect(await deleteSelfServeLogins(client as never, { due: 3, userIds: [A, B, C] }, logger)).toEqual({
      due: 3,
      deleted: 1,
      skipped: 2,
      failed: 0,
    });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(C);
  });

  it('skips a login whose sign-up row has gone', async () => {
    const { client, deleteUser } = service({ signups: { [A]: { data: null, error: null } } });
    expect((await deleteSelfServeLogins(client as never, { due: 1, userIds: [A] }, logger)).skipped).toBe(1);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('counts failures, never deletes when the re-check fails, and carries on with the rest', async () => {
    const { client, deleteUser } = service({
      signups: { [A]: { data: null, error: { message: 'connection reset' } } },
      members: { [B]: { count: null, error: { message: 'timeout' } } },
      deleteErrors: { [C]: { message: 'Database error deleting user' } },
    });
    expect(await deleteSelfServeLogins(client as never, { due: 3, userIds: [A, B, C] }, logger)).toEqual({
      due: 3,
      deleted: 0,
      skipped: 0,
      failed: 3,
    });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });
});
