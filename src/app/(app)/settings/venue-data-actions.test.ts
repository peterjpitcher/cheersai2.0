import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// requestVenueClosure: "Ask us to close this venue". admin_audit is an
// in-memory table that logAdminEvent writes to and the repeat check reads,
// so "a second request the same day sends nothing" runs through both.

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-25T13:05:00Z'); // the clock-change Sunday: 13:05 GMT
const BAD_OUTPUT = /undefined|NaN|Invalid Date|href=""|null/;

type AuditRow = { action: string; target_account_id: string | null; result: string; created_at: string };
const auditRows: AuditRow[] = [];
let auditReadError: { message: string } | null = null;

/** Just enough of the query builder for findRecentClosureRequest. */
function fakeService() {
  return {
    from(table: string) {
      expect(table).toBe('admin_audit');
      const filters: Array<(row: AuditRow) => boolean> = [];
      const builder = {
        select: () => builder,
        eq(column: keyof AuditRow, value: string) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        gt(column: keyof AuditRow, value: string) {
          filters.push((row) => Date.parse(String(row[column])) > Date.parse(value));
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() {
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

function context(role: 'owner' | 'member' = 'owner', businessName: string | null = 'The Test Arms & Kitchen') {
  return {
    user: { id: OWNER, email: 'owner@venue.test', businessName },
    supabase: fakeService(),
    accountId: BRAND,
    role,
  };
}

function sentTo(address: string) {
  return mockSendEmail.mock.calls.map(([message]) => message).filter((message) => message.to === address);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  auditRows.length = 0;
  auditReadError = null;
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
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('a second request the same day sends no email at all and says when they asked', async () => {
    await requestVenueClosure({ accountId: BRAND });
    mockSendEmail.mockClear();
    mockAudit.mockClear();

    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 60 * 1000));
    const second = await requestVenueClosure({ accountId: BRAND });

    expect(second).toEqual({ success: true, alreadyRequested: true, requestedAt: NOW.toISOString() });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('a request more than a day later is sent again', async () => {
    await requestVenueClosure({ accountId: BRAND });
    mockSendEmail.mockClear();
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 60 * 60 * 1000));

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

describe('requestVenueClosure: who may ask', () => {
  it('refuses a member on the server: no email, no record', async () => {
    mockAuth.mockResolvedValue(context('member'));
    expect(await requestVenueClosure({ accountId: BRAND })).toEqual({
      error: 'Only an owner of this venue can do this. Ask an owner, or email peter@orangejelly.co.uk.',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
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
});

describe('requestVenueClosure: each failing dependency', () => {
  it('the repeat check: refused with our address and alerted, nothing sent', async () => {
    auditReadError = { message: 'connection refused' };
    const result = await requestVenueClosure({ accountId: BRAND });
    expect(result.error).toMatch(/could not send your request.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: expect.stringContaining('admin_audit') }));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('the operator email: refused with our address and alerted, not recorded, no confirmation', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('Resend API error: 503'));
    const result = await requestVenueClosure({ accountId: BRAND });
    expect(result.error).toMatch(/could not send your request.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('closure_request', expect.objectContaining({ message: expect.stringContaining('operator email') }));
    expect(mockAudit).not.toHaveBeenCalled();
    expect(sentTo('owner@venue.test')).toHaveLength(0);

    // Nothing was recorded, so trying again sends it.
    mockSendEmail.mockClear();
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
