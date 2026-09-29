import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// createSelfServeVenue (spec §4.4): every dependency is mocked so each can be
// made to fail, and each failure must show the person an error with our email
// address and alert the operator (§4.9, §4.12).
// ---------------------------------------------------------------------------

const mockEnv = {
  server: { VERCEL_ENV: 'production', OPERATOR_ALERT_EMAIL: 'ops@cheers.test' as string | undefined },
  client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' },
};
vi.mock('@/env', () => ({ env: mockEnv }));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}));

// next/server after(): the callbacks are kept, and run by the test when it chooses
// (after the action has already answered, as on Vercel).
const afterCallbacks: Array<() => unknown> = [];
vi.mock('next/server', () => ({ after: (callback: () => unknown) => afterCallbacks.push(callback) }));
async function runAfter(): Promise<void> {
  const callbacks = afterCallbacks.splice(0);
  for (const callback of callbacks) await callback();
}

type SwitchState = 'open' | 'closed' | 'enforcement_off' | 'unavailable';
const mockSwitch = vi.fn<() => Promise<SwitchState>>(async () => 'open');
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

type LimitAnswer = { status: 'allowed' } | { status: 'limited'; retryAfterSeconds: number };
type Subject = { email: string; ip: string; userId?: string };
const mockConsume = vi.fn<(action: string, subject: Subject) => Promise<LimitAnswer>>(async () => ({ status: 'allowed' }));
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeAuthRateLimit: (action: string, subject: Subject) => mockConsume(action, subject),
  clientIpFromHeaders: (headers: Headers) => headers.get('x-forwarded-for') ?? 'unknown',
}));

const mockReport = vi.fn<(kind: string, error: unknown) => Promise<void>>(async () => {});
vi.mock('@/lib/signup/alerts', () => ({ reportSignupFailure: (kind: string, error: unknown) => mockReport(kind, error) }));

const mockSendEmail = vi.fn<(message: { to: string; subject: string; html: string; required?: boolean }) => Promise<void>>(
  async () => {},
);
vi.mock('@/lib/email/resend', () => ({
  sendEmail: (message: { to: string; subject: string; html: string; required?: boolean }) => mockSendEmail(message),
}));

const mockAudit = vi.fn<(params: Record<string, unknown>) => Promise<void>>(async () => {});
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (params: Record<string, unknown>) => mockAudit(params) }));

vi.mock('@/lib/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('@/lib/billing/setup-redirect', () => ({ BILLING_SETUP_PATH: '/settings#billing', destinationAfterPasswordSet: vi.fn() }));

// The signed-in login (the verified session) and its updateUser.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
type Login =
  | { status: 'signed_in'; user: { id: string; email: string; emailConfirmed: boolean; cameFromEmailLink: boolean } }
  | { status: 'signed_out' }
  | { status: 'unavailable'; error: string };
const signedIn = (overrides: Partial<{ email: string; emailConfirmed: boolean }> = {}): Login => ({
  status: 'signed_in',
  user: { id: USER_ID, email: 'owner@venue.test', emailConfirmed: true, cameFromEmailLink: true, ...overrides },
});
const mockReadLogin = vi.fn<() => Promise<Login>>(async () => signedIn());

type ProvisionAnswer = { data: unknown; error: { message: string; code?: string } | null };
const mockRpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<ProvisionAnswer>>(async () => ({
  data: { status: 'created', account_id: ACCOUNT_ID },
  error: null,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({ rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) }),
}));

// Who the login is (readVenueSignupState); decideVenueAccess stays real.
type VenueState = import('@/lib/signup/venue').VenueSignupState;
const NEW_LOGIN: VenueState = {
  memberships: [],
  isAdmin: false,
  hasOpenInvitation: false,
  signup: { accountId: null, verifiedAt: '2026-09-28T09:00:00Z', venueCreatedAt: null },
};
const mockReadState = vi.fn<(service: unknown, userId: string) => Promise<VenueState>>(async () => NEW_LOGIN);

vi.mock('@/lib/signup/venue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/signup/venue')>();
  return {
    ...actual,
    readSignedInLogin: () => mockReadLogin(),
    readVenueSignupState: (service: unknown, userId: string) => mockReadState(service, userId),
  };
});

type UpdateAnswer = { error: { status?: number; code?: string; message: string } | null };
const mockUpdateUser = vi.fn<(attributes: Record<string, unknown>) => Promise<UpdateAnswer>>(async () => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { updateUser: (attributes: Record<string, unknown>) => mockUpdateUser(attributes) } }),
}));

const { createSelfServeVenue } = await import('@/app/signup/venue/actions');
const { VENUE_MESSAGES } = await import('@/lib/signup/messages');

const CONTACT_EMAIL = 'peter@orangejelly.co.uk';

function form(overrides: Record<string, string | null> = {}): FormData {
  const values: Record<string, string | null> = {
    email: ' Owner@Venue.test ',
    fullName: 'Sam Owner',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
    venueName: 'The Crown & Anchor',
    venueType: 'pub',
    business: 'on',
    ...overrides,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== null) fd.set(key, value);
  return fd;
}

function provisionCalls() {
  return mockRpc.mock.calls.filter(([fn]) => fn === 'provision_self_serve_brand');
}

function expectRefusedWithAlert(result: { error?: string; success?: boolean }, kind: string) {
  expect(result.success).toBeUndefined();
  expect(result.error).toBe(VENUE_MESSAGES.couldNotFinish);
  expect(result.error).toContain(CONTACT_EMAIL);
  expect(mockReport).toHaveBeenCalledWith(kind, expect.anything());
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  mockReadState.mockResolvedValue(NEW_LOGIN);
  mockEnv.server.VERCEL_ENV = 'production';
  mockEnv.server.OPERATOR_ALERT_EMAIL = 'ops@cheers.test';
  mockSwitch.mockResolvedValue('open');
  mockReadLogin.mockResolvedValue(signedIn());
  mockConsume.mockResolvedValue({ status: 'allowed' });
  mockUpdateUser.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: { status: 'created', account_id: ACCOUNT_ID }, error: null });
  mockAudit.mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(undefined);
});

describe('createSelfServeVenue: the happy path', () => {
  it('saves the password and name, creates the brand from the session user, records it, tells the operator and goes to Billing', async () => {
    const result = await createSelfServeVenue(form());

    expect(result).toEqual({ success: true, next: '/settings#billing' });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'correct horse battery', data: { full_name: 'Sam Owner' } });
    expect(provisionCalls()).toEqual([
      [
        'provision_self_serve_brand',
        {
          p_user_id: USER_ID,
          p_venue_name: 'The Crown & Anchor',
          p_business_type: 'pub',
          p_email: 'owner@venue.test',
          p_legal_version: '2026-09-29.1',
        },
      ],
    ]);
    expect(mockConsume).toHaveBeenCalledWith('signup_venue', { email: '', ip: '203.0.113.7', userId: USER_ID });
    expect(mockReadState).toHaveBeenCalledWith(expect.anything(), USER_ID);

    // Nothing is announced until the response has gone: then the record and the email.
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
    await runAfter();
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      action: 'self_serve_venue_created',
      targetUserId: USER_ID,
      targetAccountId: ACCOUNT_ID,
    });
    // The audit row holds ids only.
    expect(JSON.stringify(mockAudit.mock.calls[0]![0])).not.toMatch(/Crown|owner@venue/);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const email = mockSendEmail.mock.calls[0]![0];
    expect(email.to).toBe('ops@cheers.test');
    expect(email.subject).toBe('[Cheers operator] New self-serve venue');
    expect(email.html).toContain('The Crown &amp; Anchor');
    expect(email.html).toContain('Type: Pub');
    expect(email.html).toContain('owner@venue.test');
    expect(email.html).toContain(ACCOUNT_ID);
    expect(email.html).toContain('https://cheers.orangejelly.co.uk/admin');
    expect(email.html).toMatch(/Created: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2} \(UK time\)/);
    for (const bad of ['undefined', 'NaN', 'Invalid Date', 'Invalid DateTime', 'null']) expect(email.html).not.toContain(bad);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('stores "hospitality venue" for Other, so the AI never writes as a non-hospitality business', async () => {
    await createSelfServeVenue(form({ venueType: 'other' }));
    expect(provisionCalls()[0]![1].p_business_type).toBe('hospitality venue');
  });

  it('ignores any user id or account id in the form: only the session decides', async () => {
    const fd = form();
    fd.set('userId', '99999999-9999-4999-8999-999999999999');
    fd.set('p_user_id', '99999999-9999-4999-8999-999999999999');
    fd.set('accountId', '99999999-9999-4999-8999-999999999999');
    await createSelfServeVenue(fd);
    expect(provisionCalls()[0]![1].p_user_id).toBe(USER_ID);
    expect(JSON.stringify(provisionCalls()[0]![1])).not.toContain('99999999');
  });

  it('a double submit racing the first (the venue not there yet at the pre-check) gets the same brand back and announces nothing twice', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'existing', account_id: ACCOUNT_ID }, error: null });
    // The first submit already set this password.
    mockUpdateUser
      .mockResolvedValueOnce({ error: { status: 422, code: 'same_password', message: 'New password should be different from the old password.' } })
      .mockResolvedValueOnce({ error: null });

    const result = await createSelfServeVenue(form());

    expect(result).toEqual({ success: true, next: '/settings#billing' });
    expect(mockUpdateUser).toHaveBeenLastCalledWith({ data: { full_name: 'Sam Owner' } });
    expect(afterCallbacks).toHaveLength(0);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('a refresh or second tab after the venue exists goes to Billing, saving and creating nothing', async () => {
    mockReadState.mockResolvedValue({
      ...NEW_LOGIN,
      memberships: [{ accountId: ACCOUNT_ID, usable: true }],
      signup: { accountId: ACCOUNT_ID, verifiedAt: '2026-09-28T09:00:00Z', venueCreatedAt: '2026-09-28T09:05:00Z' },
    });
    expect(await createSelfServeVenue(form({ password: 'a different password', confirm: 'a different password' }))).toEqual({
      success: true,
      next: '/settings#billing',
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe('createSelfServeVenue: who may create a venue is checked before anything is saved (review of PR #146)', () => {
  const OTHER = '33333333-3333-4333-8333-333333333333';
  it.each<[string, Partial<VenueState>, string]>([
    ['a member of another live brand', { memberships: [{ accountId: OTHER, usable: true }] }, VENUE_MESSAGES.member],
    ['a member of only archived brands', { memberships: [{ accountId: OTHER, usable: false }] }, VENUE_MESSAGES.memberNoBrand],
    ['an app admin', { isAdmin: true }, VENUE_MESSAGES.admin],
    ['someone with an open invitation', { hasOpenInvitation: true }, VENUE_MESSAGES.invited],
    [
      'someone removed from the venue they set up',
      { signup: { accountId: ACCOUNT_ID, verifiedAt: 'v', venueCreatedAt: 'c' } },
      VENUE_MESSAGES.removed,
    ],
    [
      'someone whose venue was deleted',
      { signup: { accountId: null, verifiedAt: 'v', venueCreatedAt: 'c' } },
      VENUE_MESSAGES.venueClosed,
    ],
    [
      'someone whose venue was archived',
      { memberships: [{ accountId: ACCOUNT_ID, usable: false }], signup: { accountId: ACCOUNT_ID, verifiedAt: 'v', venueCreatedAt: 'c' } },
      VENUE_MESSAGES.venueClosed,
    ],
  ])('refuses %s, and their password and name are NOT changed', async (_label, state, message) => {
    mockReadState.mockResolvedValue({ ...NEW_LOGIN, ...state });
    expect(await createSelfServeVenue(form())).toEqual({ error: message });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('a closed switch refuses before anything is saved (password and name NOT changed)', async () => {
    mockSwitch.mockResolvedValue('closed');
    await createSelfServeVenue(form());
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('a lookup failure refuses with our email and alerts, and changes nothing', async () => {
    mockReadState.mockRejectedValue(new Error('team_invitations: connection refused'));
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'venue_lookup');
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
  });

  it('the member, admin and invited notices point to the right next step', () => {
    expect(VENUE_MESSAGES.member).toContain(CONTACT_EMAIL);
    expect(VENUE_MESSAGES.removed).toContain(CONTACT_EMAIL);
    expect(VENUE_MESSAGES.memberNoBrand).toContain(CONTACT_EMAIL);
    expect(VENUE_MESSAGES.invited).toMatch(/Accept the invitation/);
    expect(VENUE_MESSAGES.admin).toMatch(/Create brand/);
  });
});

describe('createSelfServeVenue: the gate for confirmed sign-up links (spec §4.3)', () => {
  it('refuses on a Vercel Preview before anything else', async () => {
    mockEnv.server.VERCEL_ENV = 'preview';
    expect(await createSelfServeVenue(form())).toEqual({ error: VENUE_MESSAGES.preview });
    expect(mockSwitch).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
  });

  it('refuses while the switch is off, or on without billing enforcement, and changes nothing (no password, no brand)', async () => {
    for (const state of ['closed', 'enforcement_off'] as const) {
      mockSwitch.mockResolvedValue(state);
      const result = await createSelfServeVenue(form());
      expect(result, state).toEqual({ error: VENUE_MESSAGES.notOpen });
      expect(result.error).toContain(CONTACT_EMAIL);
    }
    expect(mockReadLogin).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    // provision_self_serve_brand re-reads only self_serve_signup, so this app gate is what stops it.
    expect(provisionCalls()).toHaveLength(0);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('an unreadable switch refuses with our email and alerts', async () => {
    mockSwitch.mockResolvedValue('unavailable');
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'switch');
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
  });

  it('the switch turned off between the checks (the database says closed) refuses and creates nothing', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'closed' }, error: null });
    const result = await createSelfServeVenue(form());
    expect(result).toEqual({ error: VENUE_MESSAGES.notOpen });
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('createSelfServeVenue: the signed-in login', () => {
  it('a session that cannot be read refuses with our email and alerts', async () => {
    mockReadLogin.mockResolvedValue({ status: 'unavailable', error: 'getUser: 503 upstream' });
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'session');
    expect(provisionCalls()).toHaveLength(0);
  });

  it('signed out: asks them to open their link again, no alert', async () => {
    mockReadLogin.mockResolvedValue({ status: 'signed_out' });
    expect(await createSelfServeVenue(form())).toEqual({ error: VENUE_MESSAGES.signedOut });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('an unconfirmed email is refused', async () => {
    mockReadLogin.mockResolvedValue(signedIn({ emailConfirmed: false }));
    expect(await createSelfServeVenue(form())).toEqual({ error: VENUE_MESSAGES.unconfirmed });
    expect(provisionCalls()).toHaveLength(0);
  });

  it("refuses an email that is not the login's, naming the login so a stranger's link is spotted", async () => {
    const result = await createSelfServeVenue(form({ email: 'someone-else@venue.test' }));
    expect(result).toEqual({ error: VENUE_MESSAGES.emailMismatch('owner@venue.test') });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
    expect(mockReport).not.toHaveBeenCalled();
  });
});

describe('createSelfServeVenue: limits and fields', () => {
  it('a limiter failure refuses with our email and alerts', async () => {
    mockConsume.mockRejectedValue(new Error('consume_rate_limit failed: connection refused'));
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'rate_limiter');
    expect(provisionCalls()).toHaveLength(0);
  });

  it('over 10 attempts an hour is refused with the wait', async () => {
    mockConsume.mockResolvedValue({ status: 'limited', retryAfterSeconds: 1500 });
    expect(await createSelfServeVenue(form())).toEqual({ error: VENUE_MESSAGES.tooManyAttempts(25) });
    expect(provisionCalls()).toHaveLength(0);
  });

  it.each([
    ['a web address', 'Visit https://evil.example'],
    ['www.', 'www.example.com Tavern'],
    ['an email address', 'Mail me@evil.example'],
    ['a line break', 'Line\nBreak Bar'],
    ['U+0085 (next line), which the database also refuses', 'Next\u0085Line Inn'],
    ['nothing', '   '],
    ['121 characters', 'x'.repeat(121)],
  ])('refuses a venue name with %s', async (_label, venueName) => {
    const result = await createSelfServeVenue(form({ venueName }));
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
    expect(provisionCalls()).toHaveLength(0);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it.each([
    ['no business tick', { business: null }, 'Tick the box to confirm you are signing up for a business.'],
    ['a short password', { password: 'short', confirm: 'short' }, 'Use at least 12 characters for your password.'],
    ['a 73-character password', { password: 'p'.repeat(73), confirm: 'p'.repeat(73) }, 'Use 72 characters or fewer for your password.'],
    ['passwords that differ', { confirm: 'different horse battery' }, 'The passwords do not match.'],
    ['no name', { fullName: '' }, 'Enter your name.'],
    ['an 81-character name', { fullName: 'n'.repeat(81) }, 'Use 80 characters or fewer for your name.'],
    ['an unknown venue type', { venueType: 'nightclub' }, 'Choose the kind of venue.'],
  ])('refuses %s', async (_label, overrides, message) => {
    expect(await createSelfServeVenue(form(overrides))).toEqual({ error: message });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
  });
});

describe('createSelfServeVenue: saving the password', () => {
  it('a weak password (Supabase policy) asks for another, no alert', async () => {
    mockUpdateUser.mockResolvedValue({ error: { status: 422, code: 'weak_password', message: 'Password is known to be weak' } });
    expect(await createSelfServeVenue(form())).toEqual({ error: VENUE_MESSAGES.weakPassword });
    expect(mockReport).not.toHaveBeenCalled();
    expect(provisionCalls()).toHaveLength(0);
  });

  it('Supabase Auth failing refuses with our email, alerts and creates nothing', async () => {
    mockUpdateUser.mockResolvedValue({ error: { status: 500, code: 'unexpected_failure', message: 'Database error' } });
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'account_update');
    expect(provisionCalls()).toHaveLength(0);
  });

  it('Supabase Auth throwing refuses with our email and alerts', async () => {
    mockUpdateUser.mockRejectedValue(new Error('fetch failed'));
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'account_update');
  });
});

describe('createSelfServeVenue: provisioning', () => {
  it('a database failure refuses with our email and alerts; nothing is announced', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection terminated', code: '08006' } });
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'provisioning');
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('a thrown error (database down) refuses with our email and alerts', async () => {
    mockRpc.mockRejectedValue(new Error('fetch failed'));
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'provisioning');
  });

  it('an answer the app does not know refuses and alerts', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'created', account_id: 'not-a-uuid' }, error: null });
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'provisioning');
    mockReport.mockClear();
    mockRpc.mockResolvedValue({ data: { status: 'something_new' }, error: null });
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'provisioning');
  });

  it("the login's stored email disagreeing is our fault: refused and alerted", async () => {
    mockRpc.mockResolvedValue({ data: { status: 'email_mismatch' }, error: null });
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'provisioning');
  });

  it('the database saying the email is unconfirmed (the session said confirmed) is our fault: refused and alerted', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'unconfirmed' }, error: null });
    expectRefusedWithAlert(await createSelfServeVenue(form()), 'provisioning');
  });

  it.each([
    ['member', VENUE_MESSAGES.member],
    ['venue_closed', VENUE_MESSAGES.venueClosed],
    ['no_login', VENUE_MESSAGES.signedOut],
    ['removed', VENUE_MESSAGES.removed],
    ['admin', VENUE_MESSAGES.admin],
    ['invited', VENUE_MESSAGES.invited],
  ])('%s from the database (it changed between the checks) is refused with its own message and no alert', async (status, message) => {
    mockRpc.mockResolvedValue({ data: { status }, error: null });
    expect(await createSelfServeVenue(form())).toEqual({ error: message });
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('a member is told to contact us for a second venue (spec §8)', () => {
    expect(VENUE_MESSAGES.member).toContain(CONTACT_EMAIL);
  });
});

describe('createSelfServeVenue: telling the operator never blocks the customer', () => {
  it('a failed operator email alerts, but the customer still goes to Billing', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend API error: 500'));
    expect(await createSelfServeVenue(form())).toEqual({ success: true, next: '/settings#billing' });
    await runAfter();
    expect(mockReport).toHaveBeenCalledWith('venue_notice', expect.any(Error));
    const alert = mockReport.mock.calls[0]![1] as Error;
    expect(alert.message).toContain(ACCOUNT_ID);
    expect(alert.message).not.toMatch(/owner@venue|Crown/);
  });

  it('a failed admin_audit write alerts, but the customer still goes to Billing and the operator is still emailed', async () => {
    mockAudit.mockRejectedValue(new Error('insert failed'));
    expect(await createSelfServeVenue(form())).toEqual({ success: true, next: '/settings#billing' });
    await runAfter();
    expect(mockReport).toHaveBeenCalledWith('venue_notice', expect.any(Error));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('no OPERATOR_ALERT_EMAIL: logged, the customer carries on', async () => {
    mockEnv.server.OPERATOR_ALERT_EMAIL = undefined;
    expect(await createSelfServeVenue(form())).toEqual({ success: true, next: '/settings#billing' });
    await runAfter();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('a Resend that hangs cannot hold up the customer: they have their answer first, and the email gives up after 5 seconds with an alert', async () => {
    vi.useFakeTimers();
    try {
      mockSendEmail.mockImplementation(() => new Promise<void>(() => {}));
      expect(await createSelfServeVenue(form())).toEqual({ success: true, next: '/settings#billing' });
      const running = runAfter();
      await vi.advanceTimersByTimeAsync(5000);
      await running;
      expect(mockReport).toHaveBeenCalledWith('venue_notice', expect.any(Error));
      expect((mockReport.mock.calls[0]![1] as Error).message).toContain(ACCOUNT_ID);
    } finally {
      vi.useRealTimers();
    }
  });
});
