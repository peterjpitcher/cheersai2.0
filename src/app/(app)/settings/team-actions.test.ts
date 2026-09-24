import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_ID = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const BRAND_ID = '2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e';
const NEW_USER_ID = '3d4e5f60-7182-4c9d-8ebf-2a3b4c5d6e7f';

// --- Supabase mock: per-table results plus captured writes ---------------------
const state = {
  memberCount: 1,
  existingUser: null as { user_id: string } | null,
  alreadyMember: null as { user_id: string } | null,
  memberInsertError: null as unknown,
  deleteResult: { data: [{ user_id: NEW_USER_ID }], error: null } as { data: unknown; error: unknown },
  updateResult: { data: [{ user_id: NEW_USER_ID }], error: null } as { data: unknown; error: unknown },
};
const inserts: Array<{ table: string; row: unknown }> = [];

function chain(table: string) {
  const c: Record<string, unknown> = {};
  let op: 'select' | 'delete' | 'update' = 'select';
  let head = false;
  let filteredByUser = false;
  c.select = vi.fn((_cols?: string, opts?: { head?: boolean }) => {
    head = Boolean(opts?.head);
    return c;
  });
  c.eq = vi.fn((column: string) => {
    if (column === 'user_id' || column === 'email') filteredByUser = true;
    return c;
  });
  c.in = vi.fn(() => c);
  c.delete = vi.fn(() => {
    op = 'delete';
    return c;
  });
  c.update = vi.fn(() => {
    op = 'update';
    return c;
  });
  c.insert = vi.fn(async (row: unknown) => {
    inserts.push({ table, row });
    return { error: table === 'account_members' ? state.memberInsertError : null };
  });
  c.maybeSingle = vi.fn(async () => {
    if (table === 'accounts') return { data: { business_name: 'The New Venue' }, error: null };
    if (table === 'user_auth_snapshot') return { data: state.existingUser, error: null };
    if (table === 'account_members' && filteredByUser) return { data: state.alreadyMember, error: null };
    return { data: null, error: null };
  });
  c.then = (resolve: (v: unknown) => unknown) => {
    if (table === 'account_members' && head) return resolve({ count: state.memberCount, error: null });
    if (op === 'delete') return resolve(state.deleteResult);
    if (op === 'update') return resolve(state.updateResult);
    return resolve({ data: [], error: null });
  };
  return c;
}

const mockGenerateLink = vi.fn();
const supabase = { from: vi.fn((t: string) => chain(t)), auth: { admin: { generateLink: mockGenerateLink } } };

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockRequireAuthContext() }));

const mockSeatLimit = vi.fn();
vi.mock('@/lib/billing/seats', () => ({ getSeatLimit: (...a: unknown[]) => mockSeatLimit(...a) }));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }));

const mockAudit = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...a: unknown[]) => mockAudit(...a) }));

vi.mock('@/lib/logging', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' }, server: {} } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { inviteTeamMember, removeTeamMember, setTeamMemberRole } = await import('./team-actions');

function ctx(role: 'owner' | 'member' = 'owner') {
  return { user: { id: OWNER_ID }, accountId: BRAND_ID, supabase, role };
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  Object.assign(state, {
    memberCount: 1,
    existingUser: null,
    alreadyMember: null,
    memberInsertError: null,
    deleteResult: { data: [{ user_id: NEW_USER_ID }], error: null },
    updateResult: { data: [{ user_id: NEW_USER_ID }], error: null },
  });
  mockRequireAuthContext.mockResolvedValue(ctx());
  mockSeatLimit.mockResolvedValue(2);
  mockSendEmail.mockResolvedValue(undefined);
  mockGenerateLink.mockResolvedValue({ data: { user: { id: NEW_USER_ID }, properties: { hashed_token: 'tok' } }, error: null });
});

describe('inviteTeamMember', () => {
  it('refuses members', async () => {
    mockRequireAuthContext.mockResolvedValue(ctx('member'));
    expect(await inviteTeamMember({ email: 'a@b.test', role: 'member' })).toEqual({ error: 'Only an owner of this brand can do that.' });
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('invites a new person into the owner\'s own brand, access saved before the email', async () => {
    const result = await inviteTeamMember({ email: 'Chef@NewVenue.test', role: 'member' });

    expect(result).toEqual({ success: true });
    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'invite', email: 'chef@newvenue.test' });
    expect(inserts).toContainEqual({
      table: 'account_members',
      row: { account_id: BRAND_ID, user_id: NEW_USER_ID, role: 'member', created_by: OWNER_ID },
    });
    const email = mockSendEmail.mock.calls[0][0] as { to: string; html: string; required: boolean };
    expect(email.to).toBe('chef@newvenue.test');
    expect(email.required).toBe(true);
    expect(email.html).toContain('The New Venue');
    expect(email.html).not.toContain('undefined');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invite', targetAccountId: BRAND_ID }));
  });

  it('adds an existing login without creating a new one', async () => {
    state.existingUser = { user_id: NEW_USER_ID };
    expect(await inviteTeamMember({ email: 'known@venue.test', role: 'owner' })).toEqual({ success: true });
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect((mockSendEmail.mock.calls[0][0] as { subject: string }).subject).toBe('You now have access to The New Venue on Cheers');
  });

  it('refuses someone who already has access', async () => {
    state.existingUser = { user_id: NEW_USER_ID };
    state.alreadyMember = { user_id: NEW_USER_ID };
    expect(await inviteTeamMember({ email: 'known@venue.test', role: 'member' })).toEqual({ error: 'That person already has access to this brand.' });
  });

  it('enforces the plan seats', async () => {
    state.memberCount = 2;
    const result = await inviteTeamMember({ email: 'a@b.test', role: 'member' });
    expect(result.error).toBe('Your plan includes 2 people. Remove someone or upgrade to add more.');
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('fails closed when the plan cannot be read', async () => {
    mockSeatLimit.mockRejectedValue(new Error('db down'));
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toBe('Could not check your plan. Please try again.');
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('sends nothing when access cannot be saved', async () => {
    state.memberInsertError = { message: 'db down' };
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toMatch(/no email was sent/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('tells the owner when the email fails, and audits the failure', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    expect((await inviteTeamMember({ email: 'a@b.test', role: 'member' })).error).toMatch(/email failed to send/);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'team_invite', result: 'failure' }));
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
