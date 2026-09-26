import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { InMemoryNotificationsTable } from '../../../../../tests/helpers/in-memory-notifications';

// The real insertNotification runs against an in-memory table that enforces
// the live NOT NULL columns; mocking the helper hid a missing `message`.
vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: vi.fn() }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/connections/health', () => ({ deriveConnectionHealth: vi.fn(() => 'red') }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://app.test' }, server: {} } }));

import { sendEmail } from '@/lib/email/resend';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { GET } from './route';

const BRAND_ID = '6f1b1c1e-8c2a-4c47-9a53-1f2e3d4c5b6a';
const CONNECTION_ID = '0b7d4a2e-3f5c-4e61-8a9b-2c3d4e5f6a7b';

let table: InMemoryNotificationsTable;
let consoleError: MockInstance<typeof console.error>;

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
  table = new InMemoryNotificationsTable();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockDb(accountRow: { email: string | null }) {
  const getUserById = vi.fn();
  const from = vi.fn((name: string) => {
    if (name === 'notifications') return table.from(name);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'neq', 'eq', 'update']) chain[method] = vi.fn(() => chain);
    if (name === 'social_connections') {
      chain.returns = vi.fn().mockResolvedValue({
        data: [
          {
            id: CONNECTION_ID,
            account_id: BRAND_ID,
            provider: 'facebook',
            status: 'expired',
            token_expires_at: null,
            expires_at: null,
            platform_account_name: 'New Venue Page',
            display_name: null,
          },
        ],
        error: null,
      });
    }
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.single = vi.fn().mockResolvedValue({ data: accountRow, error: null });
    return chain;
  });
  return { from, auth: { admin: { getUserById } } };
}

async function run() {
  const res = await GET(new Request('http://localhost/api/cron/token-health', { headers: { 'x-cron-secret': 'test-secret' } }));
  return { status: res.status, body: await res.json() };
}

describe('token-health expiry alerts', () => {
  it("records the in-app alert and emails the brand's own contact address, not the login that created the brand", async () => {
    const db = mockDb({ email: 'owner@newvenue.test' });
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(db as never);
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toMatchObject({ expired: 1, emailsSent: 1, errors: 0 });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      account_id: BRAND_ID,
      category: 'connection_expired',
      urgency: 'urgent',
      message: 'Facebook Page token expired',
      resource_id: CONNECTION_ID,
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.to).toBe('owner@newvenue.test');
    expect(email.html).toContain('New Venue Page');
    expect(email.html).not.toContain('undefined');
    expect(db.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it('sends nothing when the brand has no contact email', async () => {
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb({ email: null }) as never);

    const { status } = await run();

    expect(status).toBe(200);
    expect(table.rows).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not email again when the owner was alerted in the last 24 hours', async () => {
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb({ email: 'owner@newvenue.test' }) as never);
    table.seed({
      account_id: BRAND_ID,
      category: 'connection_expired',
      message: 'Facebook Page token expired',
      resource_type: 'connection',
      resource_id: CONNECTION_ID,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toMatchObject({ emailsSent: 0, errors: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('treats a failed insert as a failure, not as already notified, and still emails the owner', async () => {
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb({ email: 'owner@newvenue.test' }) as never);
    table.insertError = 'connection to database lost';
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body).toMatchObject({ expired: 1, emailsSent: 1, errors: 1 });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to record notification for connection ${CONNECTION_ID}`),
      'connection to database lost',
    );
  });

  it('fails the run when the email cannot be sent', async () => {
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb({ email: 'owner@newvenue.test' }) as never);
    vi.mocked(sendEmail).mockRejectedValue(new Error('Resend API error: rate limited'));

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body).toMatchObject({ emailsSent: 0, errors: 1 });
  });
});
