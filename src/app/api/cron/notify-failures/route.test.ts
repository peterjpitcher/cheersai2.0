/**
 * Tests for the notify-failures cron route.
 * Covers auth, empty results, error field rendering, fallback text, and dedup.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('@/lib/supabase/service', () => ({
  tryCreateServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/email/resend', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/notifications/insert', () => ({
  insertNotification: vi.fn(),
}));

vi.mock('@/env', () => ({
  env: {
    client: { NEXT_PUBLIC_SITE_URL: 'https://app.test' },
    server: { RESEND_API_KEY: 'test-key', RESEND_FROM: 'noreply@test.com' },
  },
}));

import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/email/resend';
import { insertNotification } from '@/lib/notifications/insert';
import { GET } from './route';

// --- Helpers ---

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/notify-failures', {
    method: 'GET',
    headers: new Headers(headers),
  });
}

/**
 * Build a chainable mock Supabase client.
 *
 * `tableResults` maps table names to their query result, allowing different
 * tables to return different data in the same test.
 */
function createMockDb(tableResults: Record<string, { data: unknown; error: unknown }>) {
  const mockFrom = vi.fn((table: string) => {
    const result = tableResults[table] ?? { data: null, error: null };

    // Build a chainable mock where every method returns `this` until a terminal
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    const terminal = vi.fn().mockResolvedValue(result);

    // Terminal methods
    chain.returns = terminal;
    chain.single = terminal;
    chain.maybeSingle = terminal;

    // Chainable methods — each returns the chain
    for (const method of ['select', 'eq', 'gt', 'filter', 'update', 'insert']) {
      chain[method] = vi.fn(() => chain);
    }

    return chain;
  });

  return { from: mockFrom };
}

// --- Tests ---

describe('notify-failures cron route', () => {
  describe('auth', () => {
    it('should return 401 when no secret is provided', async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 401 when wrong secret is provided', async () => {
      const res = await GET(makeRequest({ 'x-cron-secret': 'wrong-secret' }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('no failed jobs', () => {
    it('should return processed 0 when no failed jobs exist', async () => {
      const mockDb = createMockDb({
        publish_jobs: { data: [], error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ processed: 0, emailed: 0, skipped: 0 });
    });
  });

  describe('failed job with error_message', () => {
    it('should include error_message and error_code in the email body', async () => {
      const failedJob = {
        id: 'job-1',
        error_message: 'Token expired',
        error_code: 'AUTH_ERROR',
        content_item_id: 'ci-1',
      };

      const mockDb = createMockDb({
        publish_jobs: { data: [failedJob], error: null },
        notifications: { data: null, error: null }, // not yet notified
        content_items: { data: { account_id: 'acc-1', platform: 'instagram' }, error: null },
        posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
        accounts: { data: { email: 'owner@test.com', display_name: 'Alice' }, error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);
      vi.mocked(sendEmail).mockResolvedValue(undefined);
      vi.mocked(insertNotification).mockResolvedValue({ inserted: true });

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.emailed).toBe(1);

      // Verify email was sent with error details
      expect(sendEmail).toHaveBeenCalledOnce();
      const emailCall = vi.mocked(sendEmail).mock.calls[0][0];
      expect(emailCall.to).toBe('owner@test.com');
      expect(emailCall.html).toContain('Token expired');
      expect(emailCall.html).toContain('[AUTH_ERROR]');

      // Verify notification body includes error details
      expect(insertNotification).toHaveBeenCalledOnce();
      const notifCall = vi.mocked(insertNotification).mock.calls[0][0];
      expect(notifCall.body).toContain('Token expired');
      expect(notifCall.body).toContain('[AUTH_ERROR]');
    });
  });

  describe('failed job with null error_message', () => {
    it('should show fallback text when error_message is null', async () => {
      const failedJob = {
        id: 'job-2',
        error_message: null,
        error_code: null,
        content_item_id: 'ci-2',
      };

      const mockDb = createMockDb({
        publish_jobs: { data: [failedJob], error: null },
        notifications: { data: null, error: null },
        content_items: { data: { account_id: 'acc-2', platform: 'facebook' }, error: null },
        posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
        accounts: { data: { email: 'owner2@test.com', display_name: null }, error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);
      vi.mocked(sendEmail).mockResolvedValue(undefined);
      vi.mocked(insertNotification).mockResolvedValue({ inserted: true });

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.emailed).toBe(1);

      // Email should NOT contain an error details section (no error_message)
      const emailCall = vi.mocked(sendEmail).mock.calls[0][0];
      expect(emailCall.html).not.toContain('Error details');

      // Notification body should use fallback
      const notifCall = vi.mocked(insertNotification).mock.calls[0][0];
      expect(notifCall.body).toContain('Publishing failed');
    });
  });

  describe('already-notified job', () => {
    it('should skip jobs that have already been notified', async () => {
      const failedJob = {
        id: 'job-3',
        error_message: 'Some error',
        error_code: null,
        content_item_id: 'ci-3',
      };

      const mockDb = createMockDb({
        publish_jobs: { data: [failedJob], error: null },
        // Return an existing notification — dedup should kick in
        notifications: { data: { id: 'notif-existing' }, error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.processed).toBe(1);
      expect(body.skipped).toBe(1);
      expect(body.emailed).toBe(0);

      // Email should NOT have been sent
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
