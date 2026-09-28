import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_ID = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const BRAND_ID = '2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e';
const NEW_USER_ID = '3d4e5f60-7182-4c9d-8ebf-2a3b4c5d6e7f';
const INVITATION_ID = '4e5f6071-8293-4dae-9fc0-3b4c5d6e7f80';

// --- Supabase mock: per-table results plus captured writes ---------------------
const state = {
  memberCount: 1,
  sentLastDay: 0,
  openInvitations: 0,
  invitationCountError: null as unknown,
  existingUser: null as { user_id: string } | null,
  memberInsertError: null as unknown,
  rpcResult: { data: 'granted', error: null } as { data: unknown; error: unknown },
  invitationDeleteError: null as unknown,
  deleteResult: { data: [{ user_id: NEW_USER_ID }], error: null } as { data: unknown; error: unknown },
  updateResult: { data: [{ user_id: NEW_USER_ID }], error: null } as { data: unknown; error: unknown },
  cancelResult: { data: [{ user_id: NEW_USER_ID }], error: null } as { data: unknown; error: unknown },
};
const inserts: Array<{ table: string; row: unknown }> = [];
const deletes: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
const updates: Array<{ table: string; values: unknown; filters: Array<[string, string, unknown]> }> = [];

function chain(table: string) {
  const c: Record<string, unknown> = {};
  let op: 'select' | 'delete' | 'update' = 'select';
  let head = false;
  let updateValues: unknown = null;
  const filters: Array<[string, string, unknown]> = [];
  c.select = vi.fn((_cols?: string, opts?: { head?: boolean }) => {
    head = Boolean(opts?.head);
    return c;
  });
  for (const method of ['eq', 'is', 'gt', 'in']) {
    c[method] = vi.fn((column: string, value: unknown) => {
      filters.push([method, column, value]);
      return c;
    });
  }
  c.delete = vi.fn(() => {
    op = 'delete';
    return c;
  });
  c.update = vi.fn((values: unknown) => {
    op = 'update';
    updateValues = values;
    return c;
  });
  c.insert = vi.fn(async (row: unknown) => {
    inserts.push({ table, row });
    return { error: table === 'account_members' ? state.memberInsertError : null };
  });
  c.maybeSingle = vi.fn(async () => {
    if (table === 'accounts') return { data: { business_name: 'The New Venue' }, error: null };
    if (table === 'user_auth_snapshot') return { data: state.existingUser, error: null };
    return { data: null, error: null };
  });
  c.then = (resolve: (v: unknown) => unknown) => {
    if (table === 'account_members' && head) return resolve({ count: state.memberCount, error: null });
    if (table === 'team_invitations' && head) {
      if (state.invitationCountError) return resolve({ count: null, error: state.invitationCountError });
      // The daily count filters on created_at; the open count filters on expires_at.
      const daily = filters.some(([method, column]) => method === 'gt' && column === 'created_at');
      return resolve({ count: daily ? state.sentLastDay : state.openInvitations, error: null });
    }
    if (table === 'team_invitations' && op === 'delete') {
      deletes.push({ table, filters: [...filters] });
      return resolve({ error: state.invitationDeleteError });
    }
    if (table === 'team_invitations' && op === 'update') {
      updates.push({ table, values: updateValues, filters: [...filters] });
      return resolve(state.cancelResult);
    }
    if (op === 'delete') return resolve(state.deleteResult);
    if (op === 'update') return resolve(state.updateResult);
    return resolve({ data: [], error: null });
  };
  return c;
}

const mockGenerateLink = vi.fn();
const mockRpc = vi.fn();
const supabase = {
  from: vi.fn((t: string) => chain(t)),
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: { admin: { generateLink: mockGenerateLink } },
};

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockRequireAuthContext() }));

const mockSeatLimit = vi.fn();
vi.mock('@/lib/billing/seats', () => ({ getSeatLimit: (...a: unknown[]) => mockSeatLimit(...a) }));

const mockEntitlement = vi.fn();
vi.mock('@/lib/billing/entitlement-server', () => ({ getBrandEntitlement: (...a: unknown[]) => mockEntitlement(...a) }));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }));

const mockAudit = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...a: unknown[]) => mockAudit(...a) }));

vi.mock('@/lib/logging', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' }, server: {} } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { cancelTeamInvitation, inviteTeamMember, removeTeamMember, setTeamMemberRole } = await import('./team-actions');

function ctx(role: 'owner' | 'member' = 'owner') {
  return { user: { id: OWNER_ID }, accountId: BRAND_ID, supabase, role };
}

/** Nothing was created or sent: no login, no invite record, no membership, no email. */
function expectNothingCreated() {
  expect(mockGenerateLink).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(inserts.filter((i) => i.table === 'account_members' || i.table === 'team_invitations')).toEqual([]);
  expect(mockSendEmail).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  deletes.length = 0;
  updates.length = 0;
  Object.assign(state, {
    memberCount: 1,
    sentLastDay: 0,
    openInvitations: 0,
    invitationCountError: null,
    existingUser: null,
    memberInsertError: null,
    rpcResult: { data: 'granted', error: null },
    invitationDeleteError: null,
    deleteResult: { data: [{ user_id: NEW_USER_ID }], error: null },
    updateResult: { data: [{ user_id: NEW_USER_ID }], error: null },
    cancelResult: { data: [{ user_id: NEW_USER_ID }], error: null },
  });
  mockRequireAuthContext.mockResolvedValue(ctx());
  mockSeatLimit.mockResolvedValue(2);
  mockEntitlement.mockResolvedValue('trialing');
  mockSendEmail.mockResolvedValue(undefined);
  mockAudit.mockResolvedValue(undefined);
  mockRpc.mockImplementation(async () => state.rpcResult);
  mockGenerateLink.mockResolvedValue({ data: { user: { id: NEW_USER_ID }, properties: { hashed_token: 'tok' } }, error: null });
});

describe('inviteTeamMember: who may invite (P4)', () => {
  it('refuses members', async () => {
    mockRequireAuthContext.mockResolvedValue(ctx('member'));
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({ error: 'Only an owner of this brand can do that.' });
    expectNothingCreated();
  });

  it.each([
    ['incomplete', 'Start your plan in Billing to invite your team.'],
    ['lapsed', 'Restart your plan in Billing to invite your team.'],
    ['suspended', 'This brand is on hold, so it cannot invite people. Contact Cheers support.'],
  ])('refuses a %s brand before anything is created', async (entitlement, message) => {
    mockEntitlement.mockResolvedValue(entitlement);
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({ error: message });
    expectNothingCreated();
    expect(mockEntitlement).toHaveBeenCalledWith(supabase, BRAND_ID, expect.any(Date));
  });

  it.each(['trialing', 'active', 'past_due_grace', 'comped'])('lets a %s brand invite', async (entitlement) => {
    mockEntitlement.mockResolvedValue(entitlement);
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({ success: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the brand state cannot be read', async () => {
    mockEntitlement.mockRejectedValue(new Error('db down'));
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({ error: 'Could not check your plan. Please try again.' });
    expectNothingCreated();
  });
});

describe('inviteTeamMember: the daily cap and seats', () => {
  it('refuses the sixth invite in 24 hours before creating a login', async () => {
    state.sentLastDay = 5;
    mockSeatLimit.mockResolvedValue(null);
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({
      error: 'You can send up to 5 invites in any 24 hours. Please try again later.',
    });
    expectNothingCreated();
  });

  it('allows the fifth invite in 24 hours', async () => {
    state.sentLastDay = 4;
    mockSeatLimit.mockResolvedValue(null);
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({ success: true });
  });

  it('refuses when the database says the cap was reached meanwhile, and sends nothing', async () => {
    state.existingUser = { user_id: NEW_USER_ID };
    state.rpcResult = { data: 'daily_limit', error: null };
    expect((await inviteTeamMember({ email: 'known@venue.test', role: 'member' })).error).toMatch(/up to 5 invites/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('counts invitations not yet accepted towards the seats', async () => {
    state.memberCount = 1;
    state.openInvitations = 1;
    const result = await inviteTeamMember({ email: 'a@b.test', role: 'member' });
    expect(result.error).toBe(
      'Your plan includes 2 people, counting invitations not yet accepted. Remove someone, cancel an invitation or upgrade to add more.',
    );
    expectNothingCreated();
  });

  it('enforces the plan seats', async () => {
    state.memberCount = 2;
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toMatch(/^Your plan includes 2 people/);
    expectNothingCreated();
  });

  it('passes the seat limit to the database, which checks it again under a lock', async () => {
    await inviteTeamMember({ email: 'a@b.test', role: 'member' });
    expect(mockRpc).toHaveBeenCalledWith('record_team_invitation', expect.objectContaining({ p_seat_limit: 2, p_daily_limit: 5 }));
  });

  it('fails closed when the plan cannot be read', async () => {
    mockSeatLimit.mockRejectedValue(new Error('db down'));
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toBe('Could not check your plan. Please try again.');
    expectNothingCreated();
  });

  it('fails closed when the invite count cannot be read', async () => {
    state.invitationCountError = { message: 'db down' };
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toBe('Could not check your plan. Please try again.');
    expectNothingCreated();
  });
});

describe('inviteTeamMember: someone who already has a login', () => {
  beforeEach(() => {
    state.existingUser = { user_id: NEW_USER_ID };
    state.rpcResult = { data: 'invited', error: null };
  });

  it('creates a pending invitation, not a membership, and asks them to accept', async () => {
    expect(await inviteTeamMember({ email: 'Known@Venue.test', role: 'owner' })).toEqual({ success: true });

    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith('record_team_invitation', {
      p_account_id: BRAND_ID,
      p_user_id: NEW_USER_ID,
      p_role: 'owner',
      p_invited_by: OWNER_ID,
      p_seat_limit: 2,
      p_daily_limit: 5,
      p_grant_access: false,
    });
    expect(inserts.filter((i) => i.table === 'account_members')).toEqual([]);

    const email = mockSendEmail.mock.calls[0][0] as { to: string; subject: string; html: string; required: boolean };
    expect(email.to).toBe('known@venue.test');
    expect(email.required).toBe(true);
    expect(email.subject).toBe("You're invited to join The New Venue on Cheers");
    expect(email.html).toContain('https://cheers.orangejelly.co.uk/invitations');
    expect(email.html).not.toContain('token_hash');
    expect(email.html).not.toContain('undefined');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invite', detail: { role: 'owner', pending: true } }));
  });

  it('refuses someone who already has access', async () => {
    state.rpcResult = { data: 'already_member', error: null };
    expect(await inviteTeamMember({ email: 'known@venue.test', role: 'member' })).toEqual({ error: 'That person already has access to this brand.' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('refuses someone who already has an invitation waiting', async () => {
    state.rpcResult = { data: 'already_invited', error: null };
    expect(await inviteTeamMember({ email: 'known@venue.test', role: 'member' })).toEqual({
      error: 'That person already has an invitation to this brand waiting.',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when the invitation cannot be saved', async () => {
    state.rpcResult = { data: null, error: { message: 'db down' } };
    expect(await inviteTeamMember({ email: 'known@venue.test', role: 'member' })).toEqual({
      error: 'Could not save the invitation, so no email was sent. Please try again.',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('withdraws the invitation when the email fails, so nothing is half-made', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    expect(await inviteTeamMember({ email: 'known@venue.test', role: 'member' })).toEqual({
      error: 'The email failed to send, so no invitation was made. Please try again.',
    });
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'account_id', BRAND_ID],
        ['eq', 'user_id', NEW_USER_ID],
        ['is', 'accepted_at', null],
      ]),
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invite', result: 'failure' }));
  });

  it('tells the owner if the invitation could not be withdrawn either', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    state.invitationDeleteError = { message: 'db down' };
    expect((await inviteTeamMember({ email: 'known@venue.test', role: 'member' })).error).toMatch(/invitation was saved, but the email failed/);
  });
});

describe('inviteTeamMember: a new address', () => {
  it('creates the login, then access and the invite record in one step, then emails the link', async () => {
    const result = await inviteTeamMember({ email: 'Chef@NewVenue.test', role: 'member' });

    expect(result).toEqual({ success: true });
    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'invite', email: 'chef@newvenue.test' });
    expect(mockRpc).toHaveBeenCalledWith('record_team_invitation', expect.objectContaining({ p_user_id: NEW_USER_ID, p_grant_access: true }));
    const email = mockSendEmail.mock.calls[0][0] as { to: string; html: string; required: boolean };
    expect(email.to).toBe('chef@newvenue.test');
    expect(email.required).toBe(true);
    expect(email.html).toContain('The New Venue');
    expect(email.html).toContain('token_hash=tok');
    expect(email.html).not.toContain('undefined');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invite', targetAccountId: BRAND_ID }));
  });

  it('sends nothing when access cannot be saved', async () => {
    state.rpcResult = { data: null, error: { message: 'db down' } };
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toMatch(/no email was sent/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when the database refuses at the last moment', async () => {
    state.rpcResult = { data: 'seat_limit', error: null };
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toMatch(/^Your plan includes 2 people/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('refuses when the login cannot be created', async () => {
    mockGenerateLink.mockResolvedValue({ data: null, error: { message: 'auth down' } });
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toBe('Could not create the invite. Please try again.');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('tells the owner when the email fails, and audits the failure', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toMatch(/email failed to send/);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invite', result: 'failure' }));
  });

  it('still reports success when only the audit write fails', async () => {
    mockAudit.mockRejectedValue(new Error('audit down'));
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({ success: true });
  });

  it('refuses an unexpected answer from the database rather than guessing', async () => {
    state.rpcResult = { data: 'something_else', error: null };
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toMatch(/no email was sent/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('cancelTeamInvitation', () => {
  it('refuses members', async () => {
    mockRequireAuthContext.mockResolvedValue(ctx('member'));
    expect(await cancelTeamInvitation(INVITATION_ID)).toEqual({ error: 'Only an owner of this brand can do that.' });
    expect(updates).toEqual([]);
  });

  it('cancels only an open invitation in the owner\'s own brand, keeping the row for the cap', async () => {
    expect(await cancelTeamInvitation(INVITATION_ID)).toEqual({ success: true });
    expect(deletes).toEqual([]);
    expect(updates[0].values).toEqual({ cancelled_at: expect.any(String) });
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'id', INVITATION_ID],
        ['eq', 'account_id', BRAND_ID],
        ['is', 'accepted_at', null],
        ['is', 'declined_at', null],
        ['is', 'cancelled_at', null],
      ]),
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invitation_cancel', targetAccountId: BRAND_ID }));
  });

  it('says so when the invitation is no longer open', async () => {
    state.cancelResult = { data: [], error: null };
    expect(await cancelTeamInvitation(INVITATION_ID)).toEqual({ error: 'That invitation is no longer open.' });
  });

  it('rejects bad input', async () => {
    expect(await cancelTeamInvitation('nope')).toEqual({ error: 'Invalid invitation.' });
  });
});

describe('removeTeamMember and setTeamMemberRole', () => {
  it('refuses members', async () => {
    mockRequireAuthContext.mockResolvedValue(ctx('member'));
    expect(await removeTeamMember(NEW_USER_ID)).toEqual({ error: 'Only an owner of this brand can do that.' });
    expect(await setTeamMemberRole(NEW_USER_ID, 'owner')).toEqual({ error: 'Only an owner of this brand can do that.' });
  });

  it('explains the last-owner rule from the database', async () => {
    state.deleteResult = { data: null, error: { code: '23514', message: 'A brand must keep at least one owner. Add another owner first.' } };
    expect(await removeTeamMember(OWNER_ID)).toEqual({ error: 'A brand must keep at least one owner. Make someone else an owner first.' });
    state.updateResult = { data: null, error: { code: '23514', message: 'A brand must keep at least one owner. Add another owner first.' } };
    expect(await setTeamMemberRole(OWNER_ID, 'member')).toEqual({ error: 'A brand must keep at least one owner. Make someone else an owner first.' });
  });

  it('only touches people in the owner\'s own brand', async () => {
    state.deleteResult = { data: [], error: null };
    expect(await removeTeamMember(NEW_USER_ID)).toEqual({ error: 'That person is not part of this brand.' });
  });

  it('changes a role and audits it', async () => {
    expect(await setTeamMemberRole(NEW_USER_ID, 'owner')).toEqual({ success: true });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_role_change', detail: { role: 'owner' } }));
  });

  it('rejects bad input', async () => {
    expect(await removeTeamMember('nope')).toEqual({ error: 'Invalid person.' });
    expect(await setTeamMemberRole(NEW_USER_ID, 'admin' as never)).toEqual({ error: 'Invalid change.' });
  });
});
