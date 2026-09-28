import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '5f607182-93a4-4ebf-80d1-4c5d6e7f8091';
const OTHER_USER_ID = '60718293-a4b5-4fc0-91e2-5d6e7f809102';
const INVITATION_ID = '718293a4-b5c6-40d1-a2f3-6e7f80910213';
const BRAND_ID = '8293a4b5-c6d7-41e2-b304-7f8091021324';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: () => mockGetUser() } }),
}));

const state = {
  declineResult: { data: [{ account_id: BRAND_ID }], error: null } as { data: unknown; error: unknown },
  lookup: { data: { account_id: BRAND_ID }, error: null } as { data: unknown; error: unknown },
};
const lookups: Array<Array<[string, string, unknown]>> = [];
const updates: Array<{ values: unknown; filters: Array<[string, string, unknown]> }> = [];
const mockRpc = vi.fn();

function chain() {
  const c: Record<string, unknown> = {};
  let op: 'select' | 'update' = 'select';
  let values: unknown = null;
  const filters: Array<[string, string, unknown]> = [];
  c.select = vi.fn(() => c);
  c.update = vi.fn((v: unknown) => {
    op = 'update';
    values = v;
    return c;
  });
  for (const method of ['eq', 'is', 'gt']) {
    c[method] = vi.fn((column: string, value: unknown) => {
      filters.push([method, column, value]);
      return c;
    });
  }
  c.maybeSingle = vi.fn(async () => {
    lookups.push([...filters]);
    return state.lookup;
  });
  c.then = (resolve: (v: unknown) => unknown) => {
    if (op === 'update') {
      updates.push({ values, filters: [...filters] });
      return resolve(state.declineResult);
    }
    return resolve({ data: [], error: null });
  };
  return c;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({ from: vi.fn(() => chain()), rpc: (...a: unknown[]) => mockRpc(...a) }),
}));

const mockEntitlement = vi.fn();
vi.mock('@/lib/billing/entitlement-server', () => ({ getBrandEntitlement: (...a: unknown[]) => mockEntitlement(...a) }));

const mockAudit = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...a: unknown[]) => mockAudit(...a) }));
vi.mock('@/lib/logging', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));
const mockRevalidate = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => mockRevalidate(...a) }));

const { acceptInvitation, declineInvitation } = await import('./actions');

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  lookups.length = 0;
  state.declineResult = { data: [{ account_id: BRAND_ID }], error: null };
  state.lookup = { data: { account_id: BRAND_ID }, error: null };
  mockEntitlement.mockResolvedValue('comped');
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mockRpc.mockResolvedValue({ data: 'accepted', error: null });
  mockAudit.mockResolvedValue(undefined);
});

describe('acceptInvitation', () => {
  it('accepts for the signed-in person only, and audits it', async () => {
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('accept_team_invitation', { p_invitation_id: INVITATION_ID, p_user_id: USER_ID });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team_invitation_accept', actorUserId: USER_ID, targetAccountId: BRAND_ID }),
    );
    expect(mockRevalidate).toHaveBeenCalledWith('/', 'layout');
  });

  it('refuses an expired invitation and grants nothing', async () => {
    mockRpc.mockResolvedValue({ data: 'expired', error: null });
    expect(await acceptInvitation(INVITATION_ID)).toEqual({
      error: 'This invitation has expired. Ask the brand owner to send a new one.',
    });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('refuses a declined, cancelled or closed-brand invitation', async () => {
    mockRpc.mockResolvedValue({ data: 'closed', error: null });
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'This invitation is no longer open.' });
  });

  it('treats someone else\'s invitation as not found', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: OTHER_USER_ID } }, error: null });
    state.lookup = { data: null, error: null };
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'We could not find that invitation.' });
    expect(lookups[0]).toEqual(expect.arrayContaining([['eq', 'id', INVITATION_ID], ['eq', 'user_id', OTHER_USER_ID]]));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('still refuses in the database if the invitation turns out not to be theirs', async () => {
    mockRpc.mockResolvedValue({ data: 'not_found', error: null });
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'We could not find that invitation.' });
  });

  it.each([
    ['lapsed', /plan has lapsed, so it cannot add people/],
    ['suspended', /on hold, so it cannot add people/],
    ['incomplete', /has not started its plan, so it cannot add people/],
    ['archived', /no longer open/],
  ])('refuses while the brand is %s, so it cannot gain members', async (entitlement, message) => {
    mockEntitlement.mockResolvedValue(entitlement);
    expect((await acceptInvitation(INVITATION_ID)).error).toMatch(message);
    expect(mockEntitlement).toHaveBeenCalledWith(expect.anything(), BRAND_ID);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it.each(['trialing', 'active', 'past_due_grace', 'comped'])('accepts while the brand is %s', async (entitlement) => {
    mockEntitlement.mockResolvedValue(entitlement);
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ success: true });
  });

  it('fails closed when the brand state cannot be read', async () => {
    mockEntitlement.mockRejectedValue(new Error('db down'));
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'We could not finish this. Please try again.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('fails closed when the invitation cannot be looked up', async () => {
    state.lookup = { data: null, error: { message: 'db down' } };
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'We could not finish this. Please try again.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('is fine to press twice', async () => {
    mockRpc.mockResolvedValue({ data: 'already_accepted', error: null });
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ success: true });
  });

  it('refuses when signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'Please sign in again to accept this invitation.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('shows an error when the database fails, never a silent success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'We could not finish this. Please try again.' });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('shows an error when the session check itself fails', async () => {
    mockGetUser.mockRejectedValue(new Error('auth down'));
    expect(await acceptInvitation(INVITATION_ID)).toEqual({ error: 'We could not finish this. Please try again.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed id', async () => {
    expect(await acceptInvitation('nope')).toEqual({ error: 'We could not find that invitation.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('declineInvitation', () => {
  it('declines only the signed-in person\'s own open invitation', async () => {
    expect(await declineInvitation(INVITATION_ID)).toEqual({ success: true });
    expect(updates[0].values).toEqual({ declined_at: expect.any(String) });
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'id', INVITATION_ID],
        ['eq', 'user_id', USER_ID],
        ['is', 'accepted_at', null],
        ['is', 'declined_at', null],
        ['is', 'cancelled_at', null],
      ]),
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invitation_decline', targetAccountId: BRAND_ID }));
  });

  it('says so when it is no longer open', async () => {
    state.declineResult = { data: [], error: null };
    expect(await declineInvitation(INVITATION_ID)).toEqual({ error: 'This invitation is no longer open.' });
  });

  it('shows an error when the database fails', async () => {
    state.declineResult = { data: null, error: { message: 'db down' } };
    expect(await declineInvitation(INVITATION_ID)).toEqual({ error: 'We could not finish this. Please try again.' });
  });
});
