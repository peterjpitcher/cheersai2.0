import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteSelfServeLogins, parseSelfServeLoginList } from '@/lib/signup/login-cleanup';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Check = { data: unknown; error: { message: string } | null } | Error;

function service(options: { checks?: Record<string, Check>; deleteErrors?: Record<string, { message: string }> }) {
  const rpc = vi.fn(async (_fn: string, args: { p_user_id: string }) => {
    const check = options.checks?.[args.p_user_id] ?? { data: true, error: null };
    if (check instanceof Error) throw check;
    return check;
  });
  const deleteUser = vi.fn(async (id: string) => ({ data: {}, error: options.deleteErrors?.[id] ?? null }));
  return { client: { rpc, auth: { admin: { deleteUser } } }, rpc, deleteUser };
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

  it('is null for anything malformed', () => {
    expect(parseSelfServeLoginList(null)).toBeNull();
    expect(parseSelfServeLoginList({ due: 1 })).toBeNull();
    expect(parseSelfServeLoginList({ due: '1', user_ids: [] })).toBeNull();
    expect(parseSelfServeLoginList({ due: 1, user_ids: ['not-a-uuid'] })).toBeNull();
  });
});

describe('deleteSelfServeLogins', () => {
  it('asks the database just before each delete, then deletes through the Auth admin API', async () => {
    const { client, rpc, deleteUser } = service({});
    expect(await deleteSelfServeLogins(client as never, { due: 2, userIds: [A, B] }, logger)).toEqual({
      due: 2,
      deleted: 2,
      skipped: 0,
      failed: 0,
    });
    expect(rpc).toHaveBeenCalledWith('self_serve_login_deletable', { p_user_id: A });
    expect(rpc).toHaveBeenCalledWith('self_serve_login_deletable', { p_user_id: B });
    expect(deleteUser).toHaveBeenCalledWith(A);
    expect(deleteUser).toHaveBeenCalledWith(B);
  });

  it('leaves a login alone when the database says it no longer qualifies', async () => {
    const { client, deleteUser } = service({ checks: { [A]: { data: false, error: null }, [B]: { data: null, error: null } } });
    expect(await deleteSelfServeLogins(client as never, { due: 3, userIds: [A, B, C] }, logger)).toEqual({
      due: 3,
      deleted: 1,
      skipped: 2,
      failed: 0,
    });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(C);
  });

  it('never deletes when the check fails, counts it, and carries on with the rest', async () => {
    const { client, deleteUser } = service({
      checks: { [A]: { data: null, error: { message: 'connection reset' } }, [B]: new Error('fetch failed') },
    });
    expect(await deleteSelfServeLogins(client as never, { due: 3, userIds: [A, B, C] }, logger)).toEqual({
      due: 3,
      deleted: 1,
      skipped: 0,
      failed: 2,
    });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(C);
  });

  it('counts a login that cannot be deleted (audit_log rows) and still deletes the others', async () => {
    const { client, deleteUser } = service({
      deleteErrors: { [A]: { message: 'Database error deleting user' } },
    });
    expect(await deleteSelfServeLogins(client as never, { due: 2, userIds: [A, B] }, logger)).toEqual({
      due: 2,
      deleted: 1,
      skipped: 0,
      failed: 1,
    });
    expect(deleteUser).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('deleteUser failed'), expect.objectContaining({ userId: A }));
  });
});
