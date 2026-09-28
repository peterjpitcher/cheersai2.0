/**
 * GET /api/cron/data-retention: runs public.run_data_retention(false), then the
 * operator purge reminder. Either failing must return 500 (fail closed); the
 * reminder goes out only when an offboarded brand is past its purge date.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const envState = vi.hoisted(() => ({ OPERATOR_ALERT_EMAIL: 'ops@test.example' as string | undefined }));

vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: vi.fn() }));
// The deletion itself is tested in src/lib/signup/login-cleanup.test.ts; the list parser stays real.
const mockDeleteLogins = vi.hoisted(() => vi.fn());
vi.mock('@/lib/signup/login-cleanup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/signup/login-cleanup')>()),
  deleteSelfServeLogins: (...args: unknown[]) => mockDeleteLogins(...args),
}));
const mockReportSignup = vi.hoisted(() => vi.fn<(kind: string, error: unknown) => Promise<void>>(async () => {}));
vi.mock('@/lib/signup/alerts', () => ({
  reportSignupFailure: (kind: string, error: unknown) => mockReportSignup(kind, error),
}));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }));
vi.mock('@/env', () => ({
  env: {
    client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.test' },
    server: envState,
  },
}));

import { sendEmail } from '@/lib/email/resend';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { GET } from './route';

const RULES = {
  notifications: { action: 'delete', cutoff: '2025-09-27T03:45:00+00:00', due: 4, done: 4 },
  booking_conversion_identifiers: { action: 'clear', cutoff: '2026-09-20T03:45:00+00:00', due: 12, done: 12 },
  oauth_states: { action: 'delete', cutoff: '2026-09-26T03:45:00+00:00', due: 0, done: 0 },
};

const RPC_OK = {
  data: { dry_run: false, ran_at: '2026-09-27T03:45:00+00:00', max_rows_per_rule: 10000, rules: RULES },
  error: null,
};

interface Db {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  accountFilters: Array<[string, ...unknown[]]>;
}

/** A service client whose RPC, accounts and subscriptions reads return what each test needs. */
function useDb(options: {
  rpc?: { data: unknown; error: { message: string } | null };
  rpcThrows?: Error;
  dueAccounts?: Array<Record<string, unknown>>;
  subscriptions?: Array<Record<string, unknown>>;
  lapsedAccounts?: Array<Record<string, unknown>>;
  accountsError?: { message: string };
}): Db {
  const accountFilters: Array<[string, ...unknown[]]> = [];
  const rpc = vi.fn(async () => {
    if (options.rpcThrows) throw options.rpcThrows;
    return options.rpc ?? RPC_OK;
  });
  const from = vi.fn((table: string) => {
    if (table === 'subscriptions') {
      // The lapsed-brand check reads subscriptions; none unless a test says so.
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'range']) chain[method] = vi.fn(() => chain);
      chain.returns = vi.fn(async () => ({ data: options.subscriptions ?? [], error: null }));
      return chain;
    }
    if (table !== 'accounts') throw new Error(`unexpected table ${table}`);
    const chain: Record<string, unknown> = {};
    let lapsedRead = false;
    for (const method of ['select', 'not', 'lte', 'order', 'in', 'is']) {
      chain[method] = vi.fn((...args: unknown[]) => {
        if (method === 'in') lapsedRead = true;
        accountFilters.push([method, ...args]);
        return chain;
      });
    }
    chain.returns = vi.fn(async () => {
      if (options.accountsError) return { data: null, error: options.accountsError };
      return { data: lapsedRead ? options.lapsedAccounts ?? [] : options.dueAccounts ?? [], error: null };
    });
    return chain;
  });
  const db = { rpc, from, accountFilters };
  vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(db as never);
  return db;
}

async function run(headers: Record<string, string> = { authorization: 'Bearer test-secret' }) {
  const res = await GET(new Request('https://cheers.test/api/cron/data-retention', { headers }));
  return { status: res.status, body: await res.json() };
}

const DUE_BRAND = {
  id: '6f1b1c1e-8c2a-4c47-9a53-1f2e3d4c5b6a',
  business_name: 'The Old Bell',
  offboarded_at: '2026-08-01T10:00:00.000Z',
  purge_after: '2026-08-31T10:00:00.000Z',
};

let consoleLog: MockInstance<typeof console.log>;
let consoleWarn: MockInstance<typeof console.warn>;
let consoleError: MockInstance<typeof console.error>;

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
  envState.OPERATOR_ALERT_EMAIL = 'ops@test.example';
  vi.mocked(sendEmail).mockResolvedValue(undefined);
  consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleLog.mockRestore();
  consoleWarn.mockRestore();
  consoleError.mockRestore();
});

describe('data-retention cron', () => {
  it('rejects a request without the cron secret and runs nothing', async () => {
    const db = useDb({});

    const { status } = await run({});

    expect(status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong cron secret', async () => {
    const db = useDb({});

    const { status } = await run({ authorization: 'Bearer wrong' });

    expect(status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('runs retention for real and returns the per-rule counts', async () => {
    const db = useDb({});

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('run_data_retention', { p_dry_run: false });
    expect(body.retention).toEqual({ ranAt: '2026-09-27T03:45:00+00:00', rules: RULES });
    expect(body.purgeReminder).toEqual({ due: 0, lapsed: 0, sent: false });
    // Every rule's counts reach the logs.
    const logged = consoleLog.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('booking_conversion_identifiers');
  });

  it('deletes the self-serve logins that never became a venue, as listed by the function', async () => {
    const userIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const db = useDb({
      rpc: {
        data: { ...RPC_OK.data, self_serve_logins: { action: 'delete_login', due: 2, max_per_run: 100, user_ids: userIds } },
        error: null,
      },
    });
    mockDeleteLogins.mockResolvedValue({ due: 2, deleted: 2, skipped: 0, failed: 0 });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(mockDeleteLogins).toHaveBeenCalledWith(db, { due: 2, userIds }, expect.anything());
    expect(body.selfServeLogins).toEqual({ due: 2, deleted: 2, skipped: 0, failed: 0 });
    // The response carries counts, never the ids.
    expect(JSON.stringify(body)).not.toContain(userIds[0]);
  });

  it('a login that cannot be deleted (audit_log rows) is skipped and alerted, and never fails the run', async () => {
    useDb({
      rpc: {
        data: {
          ...RPC_OK.data,
          self_serve_logins: {
            action: 'delete_login',
            due: 2,
            max_per_run: 100,
            user_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
          },
        },
        error: null,
      },
    });
    mockDeleteLogins.mockResolvedValue({ due: 2, deleted: 1, skipped: 0, failed: 1 });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.retention).toEqual({ ranAt: '2026-09-27T03:45:00+00:00', rules: RULES });
    expect(body.selfServeLogins).toEqual({ due: 2, deleted: 1, skipped: 0, failed: 1 });
    expect(body.purgeReminder).toEqual({ due: 0, lapsed: 0, sent: false });
    // Kind and count only: no user id, no email.
    expect(mockReportSignup).toHaveBeenCalledTimes(1);
    const [kind, error] = mockReportSignup.mock.calls[0] as [string, Error];
    expect(kind).toBe('login_cleanup');
    expect(error.message).toContain('1 of 2 self-serve logins');
    expect(error.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('does not alert when every listed login was deleted or skipped', async () => {
    useDb({
      rpc: {
        data: {
          ...RPC_OK.data,
          self_serve_logins: { action: 'delete_login', due: 1, max_per_run: 100, user_ids: ['11111111-1111-4111-8111-111111111111'] },
        },
        error: null,
      },
    });
    mockDeleteLogins.mockResolvedValue({ due: 1, deleted: 0, skipped: 1, failed: 0 });

    const { status } = await run();

    expect(status).toBe(200);
    expect(mockReportSignup).not.toHaveBeenCalled();
  });

  it('a clean-up that throws is alerted and never fails the run', async () => {
    useDb({
      rpc: {
        data: {
          ...RPC_OK.data,
          self_serve_logins: { action: 'delete_login', due: 1, max_per_run: 100, user_ids: ['11111111-1111-4111-8111-111111111111'] },
        },
        error: null,
      },
    });
    mockDeleteLogins.mockRejectedValue(new Error('boom'));

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.selfServeLogins).toEqual({ error: 'boom' });
    expect(mockReportSignup).toHaveBeenCalledWith('login_cleanup', expect.any(Error));
  });

  it('a login list the app cannot read deletes nothing, is alerted, and never fails the run', async () => {
    useDb({ rpc: { data: { ...RPC_OK.data, self_serve_logins: { due: 1, user_ids: ['not-a-uuid'] } }, error: null } });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.retention).toEqual({ ranAt: '2026-09-27T03:45:00+00:00', rules: RULES });
    expect(mockDeleteLogins).not.toHaveBeenCalled();
    expect(mockReportSignup).toHaveBeenCalledWith('login_cleanup', expect.any(Error));
  });

  it('deletes no logins when the function has no list (before the sign-up migration)', async () => {
    useDb({});

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(mockDeleteLogins).not.toHaveBeenCalled();
    expect(body.selfServeLogins).toBeNull();
  });

  it('warns when a rule hit its per-run cap and left rows for the next run', async () => {
    useDb({
      rpc: {
        data: { ...RPC_OK.data, rules: { notifications: { action: 'delete', cutoff: 'x', due: 15000, done: 10000 } } },
        error: null,
      },
    });

    const { status } = await run();

    expect(status).toBe(200);
    const warned = consoleWarn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(warned).toContain('rows left for the next run');
  });

  it('returns 500 and logs an error when the RPC fails, and still sends the reminder', async () => {
    useDb({ rpc: { data: null, error: { message: 'function public.run_data_retention(boolean) does not exist' } }, dueAccounts: [DUE_BRAND] });

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.retention).toEqual({ error: 'function public.run_data_retention(boolean) does not exist' });
    expect(body.purgeReminder).toEqual({ due: 1, lapsed: 0, sent: true });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns 500 when the RPC throws', async () => {
    useDb({ rpcThrows: new Error('fetch failed') });

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.retention).toEqual({ error: 'fetch failed' });
  });

  it('returns 500 when the RPC result is not the expected shape', async () => {
    useDb({ rpc: { data: { dry_run: true, rules: {} }, error: null } });

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.retention.error).toMatch(/unexpected result/i);
  });

  it('sends no reminder when no offboarded brand is past its purge date', async () => {
    const db = useDb({ dueAccounts: [] });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.purgeReminder).toEqual({ due: 0, lapsed: 0, sent: false });
    expect(sendEmail).not.toHaveBeenCalled();
    // Only offboarded brands whose purge date has passed are asked for.
    expect(db.accountFilters).toContainEqual(['not', 'offboarded_at', 'is', null]);
    expect(db.accountFilters.some(([method, column]) => method === 'lte' && column === 'purge_after')).toBe(true);
  });

  it('emails the operator once, listing every brand due for deletion with a link to the admin page', async () => {
    useDb({
      dueAccounts: [
        DUE_BRAND,
        { id: 'b2', business_name: 'Fish & Chips <Co>', offboarded_at: '2026-08-20T09:00:00.000Z', purge_after: '2026-09-19T09:00:00.000Z' },
      ],
    });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.purgeReminder).toEqual({ due: 2, lapsed: 0, sent: true });
    expect(sendEmail).toHaveBeenCalledOnce();
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.to).toBe('ops@test.example');
    expect(email.required).toBe(true);
    expect(email.subject).toBe('[Cheers operator] 2 offboarded brands are due for deletion');
    expect(email.html).toContain('https://cheers.test/admin#offboarding');
    expect(email.html).toContain('The Old Bell');
    expect(email.html).toContain('Fish &amp; Chips &lt;Co&gt;');
  });

  it('also lists brands whose subscription ended 90 or more days ago and that nobody has closed', async () => {
    const db = useDb({
      subscriptions: [
        { account_id: 'lapsed-1', status: 'canceled', canceled_at: '2026-05-20T09:00:00Z', current_period_end: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:01:00Z' },
      ],
      lapsedAccounts: [{ id: 'lapsed-1', business_name: 'The Plough' }],
    });

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.purgeReminder).toEqual({ due: 0, lapsed: 1, sent: true });
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.subject).toBe('[Cheers operator] 1 brand has had no subscription for 90 days');
    expect(email.html).toContain('<strong>The Plough</strong>: subscription ended 1 June 2026');
    // Comped, suspended and offboarded brands are never listed as lapsed.
    expect(db.accountFilters).toContainEqual(['is', 'offboarded_at', null]);
    expect(db.accountFilters).toContainEqual(['is', 'billing_override', null]);
  });

  it('returns 500 when the reminder cannot be sent, even though retention succeeded', async () => {
    useDb({ dueAccounts: [DUE_BRAND] });
    vi.mocked(sendEmail).mockRejectedValue(new Error('Resend API error: rate limited'));

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.retention.rules).toEqual(RULES);
    expect(body.purgeReminder).toEqual({ error: 'Resend API error: rate limited' });
  });

  it('returns 500 when brands are due but OPERATOR_ALERT_EMAIL is not set', async () => {
    envState.OPERATOR_ALERT_EMAIL = undefined;
    useDb({ dueAccounts: [DUE_BRAND] });

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.purgeReminder.error).toMatch(/OPERATOR_ALERT_EMAIL/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns 500 when the offboarded brands cannot be read', async () => {
    useDb({ accountsError: { message: 'permission denied for table accounts' } });

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.purgeReminder.error).toMatch(/accounts lookup failed/);
  });

  it('returns 500 when the service role is not configured', async () => {
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValue(null);

    const { status, body } = await run();

    expect(status).toBe(500);
    expect(body.error).toMatch(/service role/i);
  });
});
