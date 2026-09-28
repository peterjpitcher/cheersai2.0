import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = { server: { OPERATOR_ALERT_EMAIL: 'ops@orangejelly.test' }, client: {} };
vi.mock('@/env', () => ({ env: mockEnv }));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

const mockLogError = vi.fn();
vi.mock('@/lib/logging', () => ({
  createLogger: () => ({ error: (...args: unknown[]) => mockLogError(...args), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const { reportAuthFailure, resetAuthFailureAlertsForTests } = await import('@/lib/auth/alerts');

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockSendEmail.mockReset();
  mockLogError.mockClear();
  mockEnv.server.OPERATOR_ALERT_EMAIL = 'ops@orangejelly.test';
  resetAuthFailureAlertsForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reportAuthFailure', () => {
  it('logs the failure and emails the operator once', async () => {
    mockSendEmail.mockResolvedValue(undefined);
    await reportAuthFailure('rate_limiter', new Error('function public.consume_rate_limit does not exist'));

    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0]?.[0] as { to: string; subject: string; html: string; required: boolean };
    expect(sent.to).toBe('ops@orangejelly.test');
    expect(sent.subject).toBe('[Cheers operator] Sign-in problem: rate_limiter');
    expect(sent.html).toContain('consume_rate_limit does not exist');
    expect(sent.html).toContain('20260928120000');
    expect(sent.html).not.toMatch(/undefined|NaN|Invalid Date/);
  });

  it('emails at most once per kind per hour, but logs every failure', async () => {
    mockSendEmail.mockResolvedValue(undefined);
    await reportAuthFailure('sign_in', new Error('one'));
    await reportAuthFailure('sign_in', new Error('two'));
    await reportAuthFailure('password_reset', new Error('three'));

    expect(mockLogError).toHaveBeenCalledTimes(3);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it('emails again after an hour', async () => {
    mockSendEmail.mockResolvedValue(undefined);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T09:00:00Z'));
    await reportAuthFailure('magic_link', new Error('one'));
    now.mockReturnValue(Date.parse('2026-09-28T10:00:01Z'));
    await reportAuthFailure('magic_link', new Error('two'));
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it('never throws when the alert email itself fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    await expect(reportAuthFailure('password_reset', new Error('Resend down'))).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalled();
  });

  it('gives up waiting for the email after three seconds', async () => {
    vi.useFakeTimers();
    mockSendEmail.mockReturnValue(new Promise(() => {}));
    const pending = reportAuthFailure('email_link', new Error('slow'));
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeUndefined();
  });

  it('never puts an email address from the error into the log or the alert', async () => {
    mockSendEmail.mockResolvedValue(undefined);
    await reportAuthFailure(
      'magic_link',
      new Error('Resend API error: could not deliver to Owner.Name+tag@venue.test (mailbox full)'),
    );

    const [, loggedError, metadata] = mockLogError.mock.calls[0] as [string, Error, { message: string }];
    for (const text of [loggedError.message, loggedError.stack ?? '', metadata.message]) {
      expect(text).not.toContain('venue.test');
      expect(text).not.toContain('Owner.Name');
    }
    expect(loggedError.message).toBe('Resend API error: could not deliver to [email address] (mailbox full)');
    const sent = mockSendEmail.mock.calls[0]?.[0] as { to: string; html: string };
    expect(sent.to).toBe('ops@orangejelly.test');
    expect(sent.html).not.toContain('venue.test');
    expect(sent.html).toContain('could not deliver to [email address] (mailbox full)');
  });

  it('redacts a URL-encoded address too', async () => {
    mockSendEmail.mockResolvedValue(undefined);
    await reportAuthFailure('magic_link', new Error('GET /auth/v1/admin/users?filter=owner%40venue.test failed: 500'));
    const [, loggedError, metadata] = mockLogError.mock.calls[0] as [string, Error, { message: string }];
    expect(metadata.message).toBe('GET /auth/v1/admin/users?filter=[email address] failed: 500');
    expect(loggedError.message).not.toContain('venue.test');
    expect((mockSendEmail.mock.calls[0]?.[0] as { html: string }).html).not.toContain('venue.test');
  });

  it('keeps stack-trace paths that contain "@" (package scopes and versions) intact', async () => {
    const error = new Error('fetch failed');
    error.stack = [
      'Error: fetch failed',
      '    at fetchWithRetry (/var/task/node_modules/@supabase/auth-js/dist/main/lib/fetch.js:42:11)',
      '    at run (/var/task/node_modules/.pnpm/@supabase+auth-js@2.89.0/node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.js:7:3)',
    ].join('\n');
    await reportAuthFailure('magic_link', error);
    const [, loggedError] = mockLogError.mock.calls[0] as [string, Error];
    expect(loggedError.stack).toBe(error.stack);
    expect(loggedError.stack).not.toContain('[email address]');
  });

  it('still logs when no operator address is configured', async () => {
    mockEnv.server.OPERATOR_ALERT_EMAIL = '';
    await reportAuthFailure('rate_limiter', 'no database');
    expect(mockLogError).toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
