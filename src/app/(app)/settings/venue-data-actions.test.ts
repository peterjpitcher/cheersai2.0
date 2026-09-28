import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthDependencyError } from '@/lib/auth/errors';

// requestVenueClosure: "Ask us to close this venue". admin_audit is an
// in-memory table that logAdminEvent writes to and the repeat check reads,
// account_members holds the owner row, and the limiter is an in-memory
// stand-in for public.consume_rate_limit (fixed windows, atomic per call), so
// the claim, the daily cap and "a second request the same day sends nothing"
// run end to end.

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-25T13:05:00Z'); // the clock-change Sunday: 13:05 GMT
const BAD_OUTPUT = /undefined|NaN|Invalid Date|href=""|null/;

type AuditRow = { action: string; target_account_id: string | null; result: string; created_at: string };
const auditRows: AuditRow[] = [];
let auditReadError: { message: string } | null = null;
let ownerRole: string | null = 'owner';
let ownerLookupError: { message: string } | null = null;

/** Just enough of the query builder for findRecentClosureRequest and isBrandOwnerMember. */
function fakeService() {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const equals: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq(column: string, value: string) {
          equals[column] = value;
          filters.push((row) => row[column] === value);
          return builder;
        },
        gt(column: string, value: string) {
          filters.push((row) => Date.parse(String(row[column])) > Date.parse(value));
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() {
          if (table === 'account_members') {
            if (ownerLookupError) return { data: null, error: ownerLookupError };
            const match = equals.account_id === BRAND && equals.user_id === OWNER && ownerRole !== null;
            return { data: match ? { role: ownerRole } : null, error: null };
          }
          expect(table).toBe('admin_audit');
          if (auditReadError) return { data: null, error: auditReadError };
          const rows = auditRows.filter((row) => filters.every((keep) => keep(row)));
          rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          return { data: rows[0] ? { created_at: rows[0].created_at } : null, error: null };
        },
      };
      return builder;
    },
  };
}

const mockEnv = {
  server: { OPERATOR_ALERT_EMAIL: 'ops@cheers.test' as string | undefined },
  client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.test' },
};
vi.mock('@/env', () => ({ env: mockEnv }));

const mockAuth = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockAuth() }));

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'unavailable'>>();
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

/** Fixed windows keyed by action and brand, with the limits in AUTH_RATE_LIMIT_RULES. */
const LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  venue_closure_lock: { limit: 1, windowSeconds: 60 },
  venue_closure_attempt: { limit: 5, windowSeconds: 86400 },
};
const windows = new Map<string, { count: number; resetAt: number }>();
let limiterError: Error | null = null;
const mockConsume = vi.fn(async (action: string, subject: { accountId?: string }) => {
  if (limiterError) throw limiterError;
  const rule = LIMITS[action];
  if (!rule || !subject.accountId) throw new Error(`unexpected limit ${action}`);
  const key = `${action}:${subject.accountId}`;
  const now = Date.now();
  const current = windows.get(key);
  const next = !current || current.resetAt <= now ? { count: 1, resetAt: now + rule.windowSeconds * 1000 } : { ...current, count: current.count + 1 };
  windows.set(key, next);
  return next.count <= rule.limit
    ? { status: 'allowed' }
    : { status: 'limited', retryAfterSeconds: Math.ceil((next.resetAt - now) / 1000) };
});
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeAuthRateLimit: (action: string, subject: { accountId?: string }) => mockConsume(action, subject),
}));

const mockSendEmail = vi.fn<(message: { to: string; subject: string; html: string; required?: boolean }) => Promise<void>>();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (message: never) => mockSendEmail(message) }));

const mockAudit = vi.fn(async (params: { action: string; targetAccountId?: string | null; result?: string }) => {
  auditRows.push({
    action: params.action,
    target_account_id: params.targetAccountId ?? null,
    result: params.result ?? 'success',
    created_at: new Date().toISOString(),
  });
});
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (params: never) => mockAudit(params) }));

const mockAlert = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/signup/alerts', () => ({ reportSignupFailure: (...args: unknown[]) => mockAlert(...args) }));

const { requestVenueClosure } = await import('./venue-data-actions');

function context(role: 'owner' | 'member' = 'owner', businessName: string | null = 'The Test Arms & Kitchen', isSuperAdmin = false) {
  return {
    user: { id: OWNER, email: 'owner@venue.test', businessName },
    supabase: fakeService(),
    accountId: BRAND,
    role,
    isSuperAdmin,
  };
}

function sentTo(address: string) {
  return mockSendEmail.mock.calls.map(([message]) => message).filter((message) => message.to === address);
}

function advance(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  auditRows.length = 0;
  auditReadError = null;
  ownerRole = 'owner';
  ownerLookupError = null;
  windows.clear();
  limiterError = null;
  mockEnv.server.OPERATOR_ALERT_EMAIL = 'ops@cheers.test';
  mockAuth.mockResolvedValue(context());
  mockSwitch.mockResolvedValue('open');
  mockSendEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requestVenueClosure: the request', () => {
  it('emails the operator once, records it, and sends the owner one confirmation; deletes nothing', async () => {
    const result = await requestVenueClosure({ accountId: BRAND });

    expect(result).toEqual({ success: true, requestedAt: NOW.toISOString(), confirmationSent: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(2);

    const [operator] = sentTo('ops@cheers.test');
    expect(operator?.subject).toBe('[Cheers operator] Request to close a venue');
    expect(operator?.required).toBe(true);
    expect(operator?.html).toContain('The Test Arms &amp; Kitchen');
    expect(operator?.html).toContain(BRAND);
    expect(operator?.html).toContain('owner@venue.test');
    expect(operator?.html).toContain('25/10/2026, 13:05:00 (UK time)');
    expect(operator?.html).toContain('href="https://cheers.test/admin"');
    expect(operator?.html).not.toMatch(BAD_OUTPUT);

    const [confirmation] = sentTo('owner@venue.test');
    expect(confirmation?.subject).toBe('We have your request to close your venue on Cheers');
    expect(confirmation?.html).toContain('30 days');
    expect(confirmation?.html).toContain('mailto:peter@orangejelly.co.uk');
    expect(confirmation?.html).not.toMatch(BAD_OUTPUT);

    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: OWNER,
      action: 'venue_closure_request',
      targetUserId: OWNER,
      targetAccountId: BRAND,
      detail: { kind: 'owner_request' },
    });
    expect(mockConsume).toHaveBeenCalledWith('venue_closure_lock', { email: '', ip: '', accountId: BRAND });
    expect(mockConsume).toHaveBeenCalledWith('venue_closure_attempt', { email: '', ip: '', accountId: BRAND });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('a second request the same day sends no email at all and says when it was made', async () => {
    await requestVenueClosure({ accountId: BRAND });
    mockSendEmail.mockClear();
    mockAudit.mockClear();

    advance(6 * 60 * 60 * 1000);
    const second = await requestVenueClosure({ accountId: BRAND });

    expect(second).toEqual({ success: true, alreadyRequested: true, requestedAt: NOW.toISOString() });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('a request more than a day later is sent again', async () => {
    await requestVenueClosure({ accountId: BRAND });
    mockSendEmail.mockClear();
    advance(25 * 60 * 60 * 1000);

    expect((await requestVenueClosure({ accountId: BRAND })).alreadyRequested).toBeUndefined();
    expect(sentTo('ops@cheers.test')).toHaveLength(1);
    expect(sentTo('owner@venue.test')).toHaveLength(1);
  });

  it("another brand's request does not count", async () => {
    auditRows.push({ action: 'venue_closure_request', target_account_id: OTHER_BRAND, result: 'success', created_at: NOW.toISOString() });
    expect((await requestVenueClosure({ accountId: BRAND })).alreadyRequested).toBeUndefined();
    expect(sentTo('ops@cheers.test')).toHaveLength(1);
  });
});

describe('requestVenueClosure: requests at the same time', () => {
  it('two tabs (or two owners) pressing Send together send one operator email and one confirmation', async () => {
    let releaseOperatorEmail: () => void = () => {};
    mockSendEmail.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseOperatorEmail = resolve;
        }),
    );

    const first = requestVenueClosure({ accountId: BRAND });
    const second = requestVenueClosure({ accountId: BRAND });
    // The second finishes while the first is still sending: it holds no claim.
    expect(await second).toEqual({
      error: 'Wait a minute and press Send again. If it then says an owner already asked, we have your request.',
    });
    releaseOperatorEmail();
    expect(await first).toEqual({ success: true, requestedAt: NOW.toISOString(), confirmationSent: true });

    expect(sentTo('ops@cheers.test')).toHaveLength(1);
    expect(sentTo('owner@venue.test')).toHaveLength(1);
    expect(auditRows.filter((row) => row.action === 'venue_closure_request')).toHaveLength(1);
  });

  it('five simultaneous presses still send one request', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => requestVenueClosure({ accountId: BRAND })));
    expect(results.filter((result) => result.success && !result.alreadyRequested)).toHaveLength(1);
    expect(sentTo('ops@cheers.test')).toHaveLength(1);
    expect(sentTo('owner@venue.test')).toHaveLength(1);
  });

  it('a press just after another has finished is told it was already made, not "in progress"', async () => {
    await requestVenueClosure({ accountId: BRAND });
    advance(5000);
    mockSendEmail.mockClear();
    expect(await requestVenueClosure({ accountId: BRAND })).toEqual({ success: true, alreadyRequested: true, requestedAt: NOW.toISOString() });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('a send that timed out (but may have been delivered) is not repeated within the minute', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('the closure request email timed out after 5000 ms'));
    expect((await requestVenueClosure({ accountId: BRAND })).error).toMatch(/could not send your request/);
    mockSendEmail.mockClear();

    advance(20_000);
    expect((await requestVenueClosure({ accountId: BRAND })).error).toMatch(/Wait a minute and press Send again/);
    expect(mockSendEmail).not.toHaveBeenCalled();

    advance(45_000);
    expect((await requestVenueClosure({ accountId: BRAND })).success).toBe(true);
    expect(sentTo('ops@cheers.test')).toHaveLength(1);
  });

  it('a record that keeps failing emails the operator at most 5 times a day, then asks the owner to email us', async () => {
    mockAudit.mockRejectedValue(new Error('insert failed'));
    for (let i = 0; i < 5; i += 1) {
      expect((await requestVenueClosure({ accountId: BRAND })).success).toBe(true);
      advance(61_000);
    }
    expect(sentTo('ops@cheers.test')).toHaveLength(5);

    const sixth = await requestVenueClosure({ accountId: BRAND });
    expect(sixth).toEqual({
      error: 'We could not confirm your request after several tries today. Please email peter@orangejelly.co.uk to ask us to close this venue.',
    });
    advance(61_000);
    await requestVenueClosure({ accountId: BRAND });
    expect(sentTo('ops@cheers.test')).toHaveLength(5);
  });
});

describe('requestVenueClosure: who may ask', () => {
  it('refuses a member on the server: no email, no record, no claim', async () => {
    mockAuth.mockResolvedValue(context('member'));
    ownerRole = 'member';
    expect(await requestVenueClosure({ accountId: BRAND })).toEqual({
      error: 'Only an owner of this venue can do this. Ask an owner, or email peter@orangejelly.co.uk.',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it("refuses a super-admin with no owner row, so the operator cannot file (or block) the owner's request", async () => {
    mockAuth.mockResolvedValue(context('owner', 'The Test Arms', true));
    ownerRole = null;
    expect((await requestVenueClosure({ accountId: BRAND })).error).toMatch(/Only an owner of this venue/);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('a super-admin who is also a real owner of the brand may ask', async () => {
    mockAuth.mockResolvedValue(context('owner', 'The Test Arms', true));
    expect((await requestVenueClosure({ accountId: BRAND })).success).toBe(true);
  });

  it('refuses while the sign-up switch is off, with no alert', async () => {
    mockSwitch.mockResolvedValue('closed');
    expect((await requestVenueClosure({ accountId: BRAND })).error).toMatch(/not available yet/);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('refuses when the switch cannot be read, and alerts', async () => {
    mockSwitch.mockResolvedValue('unavailable');
    expect((await requestVenueClosure({ accountId: BRAND })).error).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('switch', expect.any(Error));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('refuses when the active brand changed in another tab (never closes the wrong venue)', async () => {
    expect((await requestVenueClosure({ accountId: OTHER_BRAND })).error).toMatch(/switched venue/);
    expect((await requestVenueClosure(undefined as never)).error).toMatch(/switched venue/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('a signed-out visitor is still redirected (the redirect is not swallowed)', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/auth/login;307;' });
    mockAuth.mockRejectedValue(redirect);
    await expect(requestVenueClosure({ accountId: BRAND })).rejects.toBe(redirect);
  });
});

describe('requestVenueClosure: each failing dependency', () => {
  it('the sign-in lookup (AuthDependencyError): refused with our address and alerted, with no personal data', async () => {
    mockAuth.mockRejectedValue(new AuthDependencyError('accounts lookup failed', { message: 'connection refused' }));
    expect((await requestVenueClosure({ accountId: BRAND })).error).toMatch(/could not send your request.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: 'sign-in lookup: accounts lookup failed' }));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('the owner lookup: refused with our address and alerted', async () => {
    ownerLookupError = { message: 'connection refused' };
    expect((await requestVenueClosure({ accountId: BRAND })).error).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: expect.stringContaining('owner lookup') }));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('the repeat check: refused with our address and alerted, nothing sent', async () => {
    auditReadError = { message: 'connection refused' };
    const result = await requestVenueClosure({ accountId: BRAND });
    expect(result.error).toMatch(/could not send your request.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: expect.stringContaining('admin_audit') }));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('the claim (limiter): refused with our address and alerted, nothing sent', async () => {
    limiterError = new Error('consume_rate_limit failed: connection refused');
    expect((await requestVenueClosure({ accountId: BRAND })).error).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: expect.stringContaining('claim') }));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('the operator email: refused with our address and alerted, not recorded, no confirmation', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('Resend API error: 503'));
    const result = await requestVenueClosure({ accountId: BRAND });
    expect(result.error).toMatch(/could not send your request.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: expect.stringContaining('operator email') }));
    expect(mockAudit).not.toHaveBeenCalled();
    expect(sentTo('owner@venue.test')).toHaveLength(0);

    // Nothing was recorded, so trying again once the claim has lapsed sends it.
    mockSendEmail.mockClear();
    advance(61_000);
    expect((await requestVenueClosure({ accountId: BRAND })).success).toBe(true);
    expect(sentTo('ops@cheers.test')).toHaveLength(1);
  });

  it('no operator address configured: refused and alerted', async () => {
    mockEnv.server.OPERATOR_ALERT_EMAIL = undefined;
    expect((await requestVenueClosure({ accountId: BRAND })).error).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith(
      'closure_request',
      expect.objectContaining({ message: expect.stringContaining('OPERATOR_ALERT_EMAIL') }),
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('a slow operator email times out, refused and alerted', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    mockSendEmail.mockImplementationOnce(() => new Promise(() => {}));
    const pending = requestVenueClosure({ accountId: BRAND });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).error).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: expect.stringContaining('timed out') }));
  });

  it('the admin_audit record: the owner is still told we have it (the operator has the email), and it is alerted', async () => {
    mockAudit.mockRejectedValueOnce(new Error('insert failed'));
    const result = await requestVenueClosure({ accountId: BRAND });
    expect(result).toEqual({ success: true, requestedAt: NOW.toISOString(), confirmationSent: true });
    expect(mockAlert).toHaveBeenCalledWith('closure_notice', expect.objectContaining({ message: expect.stringContaining('admin_audit') }));
    expect(sentTo('owner@venue.test')).toHaveLength(1);
  });

  it("the owner's confirmation email: the request stands, the owner is told, and it is alerted", async () => {
    mockSendEmail.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Resend API error: 422'));
    const result = await requestVenueClosure({ accountId: BRAND });
    expect(result).toEqual({ success: true, requestedAt: NOW.toISOString(), confirmationSent: false });
    expect(mockAlert).toHaveBeenCalledWith(
      'closure_notice',
      expect.objectContaining({ message: expect.stringContaining('confirmation email') }),
    );
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it('a brand with no name still gets a readable email', async () => {
    mockAuth.mockResolvedValue(context('owner', null));
    await requestVenueClosure({ accountId: BRAND });
    for (const message of mockSendEmail.mock.calls.map(([sent]) => sent)) {
      expect(message.html).toContain('Your venue');
      expect(message.html).not.toMatch(BAD_OUTPUT);
    }
  });
});
