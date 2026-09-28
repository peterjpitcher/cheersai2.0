import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteSelfServeLogins, parseSelfServeLoginList } from '@/lib/signup/login-cleanup';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Answer = { data: unknown; error: { message: string } | null } | Error;

/** The service client: only the one RPC, answering per user id (deleted unless told otherwise). */
function service(answers: Record<string, Answer> = {}) {
  const rpc = vi.fn(async (_fn: string, args: { p_user_id: string }) => {
    const answer = answers[args.p_user_id] ?? { data: { status: 'deleted' }, error: null };
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const deleteUser = vi.fn();
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
  it('leaves the decision and the delete to the database, one call per login, and never deletes itself', async () => {
    const { client, rpc, deleteUser } = service();
    expect(await deleteSelfServeLogins(client as never, { due: 2, userIds: [A, B] }, logger)).toEqual({
      due: 2,
      deleted: 2,
      skipped: 0,
      failed: 0,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('delete_stale_self_serve_login', { p_user_id: A });
    expect(rpc).toHaveBeenCalledWith('delete_stale_self_serve_login', { p_user_id: B });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('counts a login the database kept (it asked again, was invited or made a venue under the lock)', async () => {
    const { client } = service({ [A]: { data: { status: 'kept' }, error: null } });
    expect(await deleteSelfServeLogins(client as never, { due: 2, userIds: [A, B] }, logger)).toEqual({
      due: 2,
      deleted: 1,
      skipped: 1,
      failed: 0,
    });
  });

  it('counts a login that could not be deleted (audit_log rows), logs the reason, and carries on', async () => {
    const reason = '23503 update or delete on table "users" violates foreign key constraint "audit_log_user_id_fkey"';
    const { client } = service({ [A]: { data: { status: 'failed', error: reason }, error: null } });
    expect(await deleteSelfServeLogins(client as never, { due: 2, userIds: [A, B] }, logger)).toEqual({
      due: 2,
      deleted: 1,
      skipped: 0,
      failed: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be deleted'),
      expect.objectContaining({ userId: A, status: 'failed', error: reason }),
    );
  });

  it('counts an RPC error, a throw or an answer it does not understand as failed, and carries on', async () => {
    const { client } = service({
      [A]: { data: null, error: { message: 'connection reset' } },
      [B]: new Error('fetch failed'),
      [C]: { data: { status: 'maybe' }, error: null },
    });
    expect(await deleteSelfServeLogins(client as never, { due: 3, userIds: [A, B, C] }, logger)).toEqual({
      due: 3,
      deleted: 0,
      skipped: 0,
      failed: 3,
    });
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });
});
