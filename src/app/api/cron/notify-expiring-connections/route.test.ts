/**
 * Runs the real insertNotification against an in-memory notifications table
 * that enforces the live NOT NULL columns. Mocking the helper here is what
 * hid the missing `message` column for four months.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { InMemoryNotificationsTable } from '../../../../../tests/helpers/in-memory-notifications';

vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: vi.fn() }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://app.test' }, server: {} } }));

import { sendEmail } from '@/lib/email/resend';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { GET } from './route';

const ACCOUNT_ID = '6f1b1c1e-8c2a-4c47-9a53-1f2e3d4c5b6a';
const CONNECTION_ID = '0b7d4a2e-3f5c-4e61-8a9b-2c3d4e5f6a7b';
const DAY_MS = 24 * 60 * 60 * 1000;

let table: InMemoryNotificationsTable;
let consoleError: MockInstance<typeof console.error>;

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
  table = new InMemoryNotificationsTable();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

/** A connection whose token expires just under `days` days from now. */
function useDb(days: number) {
  const connection = {
    id: CONNECTION_ID,
    account_id: ACCOUNT_ID,
    provider: 'facebook',
    token_expires_at: new Date(Date.now() + days * DAY_MS - 60_000).toISOString(),
    expires_at: null,
  };
  const db = {
    from: vi.fn((name: string) => {
      if (name === 'notifications') return table.from(name);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'neq', 'or', 'eq']) chain[method] = vi.fn(() => chain);
      chain.returns = vi.fn().mockResolvedValue({ data: [connection], error: null });
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: { notifications: {} }, error: null });
      chain.single = vi.fn().mockResolvedValue({ data: { email: 'owner@anchor.test', display_name: 'Sam' }, error: null });
      return chain;
    }),
  };
  vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(db as never);
}

async function run() {
  const res = await GET(
    new Request('http://localhost/api/cron/notify-expiring-connections', { headers: { 'x-cron-secret': 'test-secret' } }),
  );
  return { status: res.status, body: await res.json() };
}

describe('notify-expiring-connections', () => {
  it('records the in-app alert and emails the owner when the token expires within 4 days', async () => {
    useDb(3);
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toEqual({ processed: 1, notified: 1, emailed: 1, skipped: 0, errors: 0 });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      category: 'connection_expiring',
      message: 'Facebook Page token expires in 3 days',
      resource_type: 'connection',
      resource_id: CONNECTION_ID,
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.to).toBe('owner@anchor.test');
    expect(email.subject).toBe('[Cheers] Facebook Page token expires in 3 days');
    expect(email.html).toContain('https://app.test/connections');
    for (const bad of ['undefined', 'NaN', 'Invalid Date', 'null']) expect(email.html).not.toContain(bad);
  });

  it('records the in-app alert but does not email when expiry is more than 4 days away', async () => {
    useDb(6);

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toMatchObject({ notified: 1, emailed: 0, errors: 0 });
    expect(table.rows[0].message).toBe('Facebook Page token expires in 6 days');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips a connection already alerted in the last 24 hours', async () => {
    useDb(3);
    table.seed({
      account_id: ACCOUNT_ID,
      category: 'connection_expiring',
      message: 'Facebook Page token expires in 4 days',
      resource_type: 'connection',
      resource_id: CONNECTION_ID,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toEqual({ processed: 1, notified: 0, emailed: 0, skipped: 1, errors: 0 });
    expect(table.rows).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('treats a failed insert as a failure, not as already notified, and still emails the owner', async () => {
    useDb(3);
    table.insertError = 'connection to database lost';
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body).toEqual({ processed: 1, notified: 0, emailed: 1, skipped: 0, errors: 1 });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to record notification for connection ${CONNECTION_ID}`),
      'connection to database lost',
    );
  });

  it('fails the run when the duplicate check fails', async () => {
    useDb(3);
    table.selectError = 'statement timeout';
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body).toMatchObject({ notified: 0, skipped: 0, errors: 1 });
    expect(table.rows).toHaveLength(0);
  });

  it('fails the run when the email cannot be sent', async () => {
    useDb(3);
    vi.mocked(sendEmail).mockRejectedValue(new Error('Resend API error: rate limited'));

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body).toEqual({ processed: 1, notified: 1, emailed: 0, skipped: 0, errors: 1 });
    expect(table.rows).toHaveLength(1);
  });
});
