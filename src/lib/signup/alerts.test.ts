import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = { server: { OPERATOR_ALERT_EMAIL: 'ops@orangejelly.test' }, client: {} };
vi.mock('@/env', () => ({ env: mockEnv }));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

const mockRpc = vi.fn();
const mockCreateService = vi.fn(() => ({ rpc: mockRpc }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => mockCreateService() }));

const mockLogAdminEvent = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockLogAdminEvent(...args) }));

const mockLogError = vi.fn();
vi.mock('@/lib/logging', () => ({
  createLogger: () => ({ error: (...args: unknown[]) => mockLogError(...args), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const { reportSignupFailure, resetSignupAlertsForTests, redactEmails } = await import('@/lib/signup/alerts');

/** The database limiter for alert keys: first call of the hour allowed, the rest counted. */
function fakeAlertCounter() {
  const hits = new Map<string, number>();
  mockRpc.mockImplementation(async (_fn: string, args: { p_key: string; p_limit: number }) => {
    const count = (hits.get(args.p_key) ?? 0) + 1;
    hits.set(args.p_key, count);
    return { data: [{ allowed: count <= args.p_limit, hits: count, resets_at: '2026-09-28T10:00:00Z' }], error: null };
  });
}

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
  mockRpc.mockReset();
  mockLogAdminEvent.mockReset();
  mockLogAdminEvent.mockResolvedValue(undefined);
  mockLogError.mockClear();
  mockCreateService.mockClear();
  mockEnv.server.OPERATOR_ALERT_EMAIL = 'ops@orangejelly.test';
  resetSignupAlertsForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reportSignupFailure', () => {
  it("files the owner's Settings actions under their own subject, with the same bookkeeping", async () => {
    for (const kind of ['owner_export', 'closure_request', 'closure_notice'] as const) {
      fakeAlertCounter();
      mockSendEmail.mockClear();
      mockLogAdminEvent.mockClear();
      await reportSignupFailure(kind, new Error('boom'));
      expect(mockLogAdminEvent).toHaveBeenCalledWith({
        actorUserId: null,
        action: 'operator_signup_alert',
        detail: { kind, count: 1 },
        result: 'failure',
      });
      const sent = mockSendEmail.mock.calls[0]?.[0] as { subject: string; html: string };
      expect(sent.subject).toBe(`[Cheers operator] Owner request problem: ${kind}`);
      expect(sent.html).toContain('Settings');
      expect(sent.html).not.toMatch(/undefined|NaN|Invalid Date/);
    }
  });

  it('records the failure in admin_audit (kind and count only), then emails the operator', async () => {
    fakeAlertCounter();
    await reportSignupFailure('turnstile', new Error('siteverify answered HTTP 503'));

    expect(mockRpc).toHaveBeenCalledWith('consume_rate_limit', {
      p_key: 'signup_alert:kind:turnstile',
      p_limit: 1,
      p_window_seconds: 3600,
    });
    expect(mockLogAdminEvent).toHaveBeenCalledWith({
      actorUserId: null,
      action: 'operator_signup_alert',
      detail: { kind: 'turnstile', count: 1 },
      result: 'failure',
    });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0]?.[0] as { to: string; subject: string; html: string; required: boolean };
    expect(sent.to).toBe('ops@orangejelly.test');
    expect(sent.subject).toBe('[Cheers operator] Sign-up problem: turnstile');
    expect(sent.html).toContain('siteverify answered HTTP 503');
    expect(sent.html).not.toMatch(/undefined|NaN|Invalid Date/);
  });

  it('emails once per kind per hour across servers, but records every failure', async () => {
    fakeAlertCounter();
    await reportSignupFailure('email', new Error('one'));
    await reportSignupFailure('email', new Error('two'));
    await reportSignupFailure('site_limit', new Error('three'));

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockLogAdminEvent).toHaveBeenCalledTimes(3);
    expect(mockLogAdminEvent.mock.calls[1]?.[0]).toMatchObject({ detail: { kind: 'email', count: 2 } });
    expect(mockLogError).toHaveBeenCalledTimes(3);
  });

  it('stops writing rows after 50 of one kind in an hour', async () => {
    mockRpc.mockResolvedValue({ data: [{ allowed: false, hits: 51, resets_at: '2026-09-28T10:00:00Z' }], error: null });
    await reportSignupFailure('site_limit', new Error('busy'));
    expect(mockLogAdminEvent).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('still emails when the database is down, once per kind per server per hour', async () => {
    mockRpc.mockRejectedValue(new Error('fetch failed'));
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T09:00:00Z'));
    await reportSignupFailure('lookup', new Error('fetch failed'));
    await reportSignupFailure('lookup', new Error('fetch failed'));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockLogAdminEvent).not.toHaveBeenCalled();

    now.mockReturnValue(Date.parse('2026-09-28T10:00:01Z'));
    await reportSignupFailure('lookup', new Error('fetch failed'));
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it('still emails when the admin_audit write fails', async () => {
    fakeAlertCounter();
    mockLogAdminEvent.mockRejectedValue(new Error('insert failed'));
    await reportSignupFailure('database', new Error('record failed'));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the alert email fails or hangs', async () => {
    fakeAlertCounter();
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    await expect(reportSignupFailure('email', new Error('Resend down'))).resolves.toBeUndefined();

    resetSignupAlertsForTests();
    vi.useFakeTimers();
    mockRpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, resets_at: '2026-09-28T10:00:00Z' }], error: null });
    mockSendEmail.mockReturnValue(new Promise(() => {}));
    const pending = reportSignupFailure('generate_link', new Error('slow'));
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeUndefined();
  });

  it('keeps email addresses out of the log and the alert', async () => {
    fakeAlertCounter();
    await reportSignupFailure('email', new Error('Resend API error: cannot send to venue.owner@example.test'));
    const sent = mockSendEmail.mock.calls[0]?.[0] as { html: string };
    expect(sent.html).not.toContain('venue.owner@example.test');
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain('venue.owner@example.test');
    expect(redactEmails('a user@x.test b')).toBe('a [email] b');
  });

  it('does not email when no operator address is set, but still records', async () => {
    fakeAlertCounter();
    mockEnv.server.OPERATOR_ALERT_EMAIL = '';
    await reportSignupFailure('switch', new Error('db down'));
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLogAdminEvent).toHaveBeenCalled();
  });
});
