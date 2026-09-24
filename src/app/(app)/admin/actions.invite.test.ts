import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ADMIN_ID = '9b2f6a51-3c4d-4e8f-9a1b-2c3d4e5f6a7b';
const NEW_USER_ID = '2a4c6e80-1b3d-4f5a-8b7c-9d0e1f2a3b4c';
const BRAND_ID = '3c5e7a91-2d4f-4a6b-9c8d-0e1f2a3b4c5d';

const mockGenerateLink = vi.fn();
const mockGetUserById = vi.fn();
const mockUpsert = vi.fn();
const mockAccountsIn = vi.fn();

const supabase = {
  auth: { admin: { generateLink: mockGenerateLink, getUserById: mockGetUserById } },
  from: vi.fn((table: string) => {
    if (table === 'account_members') return { upsert: mockUpsert };
    if (table === 'accounts') return { select: () => ({ in: mockAccountsIn }) };
    throw new Error(`unexpected table ${table}`);
  }),
};

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn(async () => ({ isSuperAdmin: true, user: { id: ADMIN_ID }, supabase })),
}));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

const mockLogAdminEvent = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockLogAdminEvent(...args) }));

vi.mock('@/lib/logging', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' }, server: {} } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { inviteUser, sendPasswordLink } = await import('@/app/(app)/admin/actions');

const INVITE = { email: 'owner@newvenue.test', accountIds: [BRAND_ID] };

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateLink.mockResolvedValue({
    data: { user: { id: NEW_USER_ID }, properties: { hashed_token: 'invite-token' } },
    error: null,
  });
  mockUpsert.mockResolvedValue({ error: null });
  mockAccountsIn.mockResolvedValue({ data: [{ business_name: 'The New Venue' }], error: null });
  mockSendEmail.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------

describe('inviteUser', () => {
  it('creates the login without Supabase sending mail, saves access, then emails our link', async () => {
    const result = await inviteUser(INVITE);

    expect(result).toEqual({ success: true });
    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'invite', email: INVITE.email });
    expect(mockUpsert).toHaveBeenCalledWith(
      [{ account_id: BRAND_ID, user_id: NEW_USER_ID, created_by: ADMIN_ID }],
      { onConflict: 'account_id,user_id' },
    );

    const sent = mockSendEmail.mock.calls[0]?.[0] as { to: string; html: string; required: boolean };
    expect(sent.to).toBe(INVITE.email);
    expect(sent.required).toBe(true);
    expect(sent.html).toContain('https://cheers.orangejelly.co.uk/auth/confirm?token_hash=invite-token&amp;type=invite');
    expect(sent.html).toContain('The New Venue');
    // Brand access is written before the email goes out.
    expect(mockUpsert.mock.invocationCallOrder[0]).toBeLessThan(mockSendEmail.mock.invocationCallOrder[0]);
  });

  it('sends nothing and tells the admin when brand access cannot be saved', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'db down' } });

    const result = await inviteUser(INVITE);

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/no email was sent/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('tells the admin and records a failure when the email cannot be sent', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));

    const result = await inviteUser(INVITE);

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/Send password link/);
    expect(mockUpsert).toHaveBeenCalled();
    expect(mockLogAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'invite_user', result: 'failure' }));
  });

  it('points the admin at brand assignment when the login already exists', async () => {
    mockGenerateLink.mockResolvedValue({ data: { user: null, properties: null }, error: { message: 'already registered' } });

    const result = await inviteUser(INVITE);

    expect(result.error).toMatch(/assign them a brand/);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('sendPasswordLink', () => {
  beforeEach(() => {
    mockGetUserById.mockResolvedValue({ data: { user: { email: 'owner@newvenue.test' } }, error: null });
    mockGenerateLink.mockResolvedValue({ data: { properties: { hashed_token: 'reset-token' } }, error: null });
  });

  it('emails a recovery link to the user', async () => {
    expect(await sendPasswordLink(NEW_USER_ID)).toEqual({ success: true });
    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'recovery', email: 'owner@newvenue.test' });
    const sent = mockSendEmail.mock.calls[0]?.[0] as { html: string };
    expect(sent.html).toContain('type=recovery');
  });

  it('shows an error when the email cannot be sent', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    const result = await sendPasswordLink(NEW_USER_ID);
    expect(result.error).toMatch(/failed to send/);
  });

  it('rejects a malformed user id', async () => {
    expect(await sendPasswordLink('not-a-uuid')).toEqual({ error: 'Invalid user.' });
    expect(mockGetUserById).not.toHaveBeenCalled();
  });
});
