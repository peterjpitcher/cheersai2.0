/**
 * Tests for the notify-failures cron route.
 * Covers auth, empty results, error field rendering, fallback text, dedup, and
 * failed writes. The real insertNotification runs against an in-memory
 * notifications table that enforces the live NOT NULL columns; mocking the
 * helper hid a missing `message` column for four months.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from 'vitest';

import { InMemoryNotificationsTable } from '../../../../../tests/helpers/in-memory-notifications';

// --- Mocks ---

vi.mock('@/lib/supabase/service', () => ({
  tryCreateServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/email/resend', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/notifications/operator-alerts', () => ({
  alertRepeatedPublishFailures: vi.fn().mockResolvedValue({ alerted: [], skipped: [] }),
}));

vi.mock('@/env', () => ({
  env: {
    client: { NEXT_PUBLIC_SITE_URL: 'https://app.test' },
    server: { RESEND_API_KEY: 'test-key', RESEND_FROM: 'noreply@test.com' },
  },
}));

import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/email/resend';
import { GET } from './route';

// --- Helpers ---

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

const ACCOUNT_ID = '6f1b1c1e-8c2a-4c47-9a53-1f2e3d4c5b6a';
const JOB_ID = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
const CONTENT_ITEM_ID = '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918';

let table: InMemoryNotificationsTable;
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.clearAllMocks();
  table = new InMemoryNotificationsTable();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
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
 * tables to return different data in the same test. `notifications` is the
 * in-memory table.
 */
function createMockDb(tableResults: Record<string, { data: unknown; error: unknown }>) {
  const mockFrom = vi.fn((name: string) => {
    if (name === 'notifications') return table.from(name);
    const result = tableResults[name] ?? { data: null, error: null };

    // Build a chainable mock where every method returns `this` until a terminal
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    const terminal = vi.fn().mockResolvedValue(result);

    // Terminal methods
    chain.returns = terminal;
    chain.single = terminal;
    chain.maybeSingle = terminal;

    // Chainable methods — each returns the chain
    for (const method of ['select', 'eq', 'gt', 'filter', 'update', 'insert', 'in', 'limit']) {
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
      expect(body).toEqual({ processed: 0, emailed: 0, skipped: 0, errors: 0, operatorAlert: { alerted: [], skipped: [] } });
    });
  });

  describe('failed job with error_message', () => {
    it('should include error_message and error_code in the email body', async () => {
      const failedJob = {
        id: JOB_ID,
        error_message: 'Token expired',
        error_code: 'AUTH_ERROR',
        content_item_id: CONTENT_ITEM_ID,
      };

      const mockDb = createMockDb({
        publish_jobs: { data: [failedJob], error: null },
        content_items: { data: { account_id: ACCOUNT_ID, platform: 'instagram' }, error: null },
        posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
        accounts: { data: { email: 'owner@test.com', display_name: 'Alice' }, error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);
      vi.mocked(sendEmail).mockResolvedValue(undefined);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.emailed).toBe(1);
      expect(body.errors).toBe(0);

      // Verify email was sent with error details
      expect(sendEmail).toHaveBeenCalledOnce();
      const emailCall = vi.mocked(sendEmail).mock.calls[0][0];
      expect(emailCall.to).toBe('owner@test.com');
      expect(emailCall.html).toContain('Token expired');
      expect(emailCall.html).toContain('[AUTH_ERROR]');

      // Verify the in-app alert was stored with a headline and the error details
      const alerts = table.rows.filter((row) => row.category === 'publish_failed');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        account_id: ACCOUNT_ID,
        message: 'Instagram post failed to publish',
        resource_type: 'content_item',
        resource_id: CONTENT_ITEM_ID,
      });
      expect(alerts[0].body).toContain('Token expired');
      expect(alerts[0].body).toContain('[AUTH_ERROR]');
    });
  });

  describe('failed job with null error_message', () => {
    it('should show fallback text when error_message is null', async () => {
      const failedJob = {
        id: JOB_ID,
        error_message: null,
        error_code: null,
        content_item_id: CONTENT_ITEM_ID,
      };

      const mockDb = createMockDb({
        publish_jobs: { data: [failedJob], error: null },
        content_items: { data: { account_id: ACCOUNT_ID, platform: 'facebook' }, error: null },
        posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
        accounts: { data: { email: 'owner2@test.com', display_name: null }, error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);
      vi.mocked(sendEmail).mockResolvedValue(undefined);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.emailed).toBe(1);

      // Email should NOT contain an error details section (no error_message)
      const emailCall = vi.mocked(sendEmail).mock.calls[0][0];
      expect(emailCall.html).not.toContain('Error details');

      // Notification body should use fallback
      const alert = table.rows.find((row) => row.category === 'publish_failed');
      expect(alert?.message).toBe('Facebook post failed to publish');
      expect(alert?.body).toContain('Publishing failed');
    });
  });

  describe('already-notified job', () => {
    it('should skip jobs that have already been notified', async () => {
      const failedJob = {
        id: JOB_ID,
        error_message: 'Some error',
        error_code: null,
        content_item_id: CONTENT_ITEM_ID,
      };

      const mockDb = createMockDb({
        publish_jobs: { data: [failedJob], error: null },
      });
      // An earlier run already emailed about this job, so dedup should kick in
      table.seed({
        account_id: ACCOUNT_ID,
        category: 'publish_failed_email_sent',
        message: 'Failure email sent',
        metadata: { job_id: JOB_ID },
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

  describe('duplicate emails', () => {
    const sendableJob = () =>
      createMockDb({
        publish_jobs: { data: [{ id: JOB_ID, error_message: null, error_code: null, content_item_id: CONTENT_ITEM_ID }], error: null },
        content_items: { data: { account_id: ACCOUNT_ID, platform: 'facebook' }, error: null },
        posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
        accounts: { data: { email: 'owner9@test.com', display_name: null }, error: null },
      });

    it('records each sent email against the job so the next run skips it', async () => {
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(sendableJob() as never);
      vi.mocked(sendEmail).mockResolvedValue(undefined);

      await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));

      expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toBe('Post failed to publish: action needed');
      expect(table.rows.find((row) => row.category === 'publish_failed_email_sent')).toMatchObject({
        account_id: ACCOUNT_ID,
        message: 'Failure email sent',
        metadata: { job_id: JOB_ID },
      });

      // A second run finds the record and sends nothing more.
      vi.mocked(sendEmail).mockClear();
      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(await res.json()).toMatchObject({ emailed: 0, skipped: 1, errors: 0 });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('treats the immediate-failure email as already sent', async () => {
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(sendableJob() as never);
      table.seed({
        account_id: ACCOUNT_ID,
        category: 'publish_failed_immediate',
        message: 'Immediate failure email sent',
        metadata: { job_id: JOB_ID },
      });

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));

      expect(await res.json()).toMatchObject({ emailed: 0, skipped: 1 });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('failed writes', () => {
    it('fails the run when the in-app alert cannot be recorded, after emailing the owner', async () => {
      const mockDb = createMockDb({
        publish_jobs: { data: [{ id: JOB_ID, error_message: 'Token expired', error_code: null, content_item_id: CONTENT_ITEM_ID }], error: null },
        content_items: { data: { account_id: ACCOUNT_ID, platform: 'instagram' }, error: null },
        posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
        accounts: { data: { email: 'owner@test.com', display_name: null }, error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);
      vi.mocked(sendEmail).mockResolvedValue(undefined);
      table.insertError = 'connection to database lost';

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));

      expect(res.status).toBe(500);
      // Two failed writes: the sent-email record and the in-app alert.
      expect(await res.json()).toMatchObject({ processed: 1, emailed: 1, skipped: 0, errors: 2 });
      expect(sendEmail).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to insert notification record for job ${JOB_ID}`),
        'connection to database lost',
      );
    });

    it('fails the run when the email cannot be sent', async () => {
      const mockDb = createMockDb({
        publish_jobs: { data: [{ id: JOB_ID, error_message: null, error_code: null, content_item_id: CONTENT_ITEM_ID }], error: null },
        content_items: { data: { account_id: ACCOUNT_ID, platform: 'facebook' }, error: null },
        posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
        accounts: { data: { email: 'owner@test.com', display_name: null }, error: null },
      });
      vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb as never);
      vi.mocked(sendEmail).mockRejectedValue(new Error('Resend API error: rate limited'));

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));

      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ emailed: 0, skipped: 0, errors: 1 });
    });
  });
});
