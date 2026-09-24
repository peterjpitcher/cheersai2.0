import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: vi.fn() }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/notifications/insert', () => ({ insertNotification: vi.fn() }));
vi.mock('@/lib/connections/health', () => ({ deriveConnectionHealth: vi.fn(() => 'red') }));
vi.mock('@/lib/notifications/routing', () => ({
  isEmailEnabledForCategory: vi.fn(() => true),
  shouldSendEmail: vi.fn(() => true),
}));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://app.test' }, server: {} } }));

import { sendEmail } from '@/lib/email/resend';
import { insertNotification } from '@/lib/notifications/insert';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { GET } from './route';

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
});

function mockDb(accountRow: { email: string | null }) {
  const getUserById = vi.fn();
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'neq', 'eq', 'update']) chain[method] = vi.fn(() => chain);
    if (table === 'social_connections') {
      chain.returns = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'conn-1',
            account_id: 'brand-1',
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

describe('token-health expiry email recipient', () => {
  it("emails the brand's own contact address, not the login that created the brand", async () => {
    const db = mockDb({ email: 'owner@newvenue.test' });
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(db as never);
    vi.mocked(insertNotification).mockResolvedValue({ inserted: true });
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    const res = await GET(new Request('http://localhost/api/cron/token-health', { headers: { 'x-cron-secret': 'test-secret' } }));

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.to).toBe('owner@newvenue.test');
    expect(email.html).toContain('New Venue Page');
    expect(email.html).not.toContain('undefined');
    expect(db.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it('sends nothing when the brand has no contact email', async () => {
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(mockDb({ email: null }) as never);
    vi.mocked(insertNotification).mockResolvedValue({ inserted: true });

    await GET(new Request('http://localhost/api/cron/token-health', { headers: { 'x-cron-secret': 'test-secret' } }));

    expect(sendEmail).not.toHaveBeenCalled();
  });
});
