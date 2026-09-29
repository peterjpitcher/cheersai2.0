import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthDependencyError } from '@/lib/auth/errors';

// POST /api/settings/data-export: the owner's "Download my data". Every
// dependency is stubbed; the file layout is the real brandExportFile, the one
// the operator's Admin export uses. The limiter is an in-memory stand-in for
// public.consume_rate_limit (fixed windows on the faked clock, atomic per
// call) with the limits in AUTH_RATE_LIMIT_RULES, so the claim, the build cap
// and the download quota run end to end.

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-28T12:00:00Z');
const A_MINUTE = 61_000;

let ownerRole: string | null = 'owner';
let ownerLookupError: { message: string } | null = null;
const SERVICE = {
  from(table: string) {
    expect(table).toBe('account_members');
    const filters: Record<string, string> = {};
    const builder = {
      select: () => builder,
      eq(column: string, value: string) {
        filters[column] = value;
        return builder;
      },
      async maybeSingle() {
        if (ownerLookupError) return { data: null, error: ownerLookupError };
        const match = filters.account_id === BRAND && filters.user_id === OWNER && ownerRole !== null;
        return { data: match ? { role: ownerRole } : null, error: null };
      },
    };
    return builder;
  },
};

const mockAuth = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockAuth() }));

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'enforcement_off' | 'unavailable'>>();
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

const LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  owner_data_export: { limit: 3, windowSeconds: 86400 },
  owner_data_export_lock: { limit: 1, windowSeconds: 60 },
  owner_data_export_attempt: { limit: 10, windowSeconds: 86400 },
};
const windows = new Map<string, { count: number; resetAt: number }>();
let limiterError: Error | null = null;

function current(action: string, accountId: string): { count: number; resetAt: number } | null {
  const row = windows.get(`${action}:${accountId}`);
  return row && row.resetAt > Date.now() ? row : null;
}
function answer(action: string, row: { count: number; resetAt: number } | null, counted: boolean) {
  const rule = LIMITS[action]!;
  const over = row ? (counted ? row.count > rule.limit : row.count >= rule.limit) : false;
  return over ? { status: 'limited', retryAfterSeconds: Math.ceil((row!.resetAt - Date.now()) / 1000) } : { status: 'allowed' };
}
const mockPeek = vi.fn(async (action: string, subject: { accountId?: string }) => {
  if (limiterError) throw limiterError;
  return answer(action, current(action, subject.accountId!), false);
});
const mockConsume = vi.fn(async (action: string, subject: { accountId?: string }) => {
  if (limiterError) throw limiterError;
  const rule = LIMITS[action];
  if (!rule || !subject.accountId) throw new Error(`unexpected limit ${action}`);
  const row = current(action, subject.accountId);
  const next = row ? { ...row, count: row.count + 1 } : { count: 1, resetAt: Date.now() + rule.windowSeconds * 1000 };
  windows.set(`${action}:${subject.accountId}`, next);
  return answer(action, next, true);
});
vi.mock('@/lib/auth/rate-limit', () => ({
  peekAuthRateLimit: (action: string, subject: { accountId?: string }) => mockPeek(action, subject),
  consumeAuthRateLimit: (action: string, subject: { accountId?: string }) => mockConsume(action, subject),
}));

const mockExport = vi.fn();
vi.mock('@/lib/admin/offboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/offboarding')>()),
  exportBrandData: (...args: unknown[]) => mockExport(...args),
}));

const mockAudit = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockAudit(...args) }));

const mockAlert = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/signup/alerts', () => ({ reportSignupFailure: (...args: unknown[]) => mockAlert(...args) }));

const { POST } = await import('./route');
const { brandExportFile } = await import('@/lib/admin/offboarding');

const EXPORT = {
  exportedAt: '2026-09-28T12:00:00.000Z',
  brand: { business_name: 'The Test Arms', email: 'owner@venue.test', timezone: 'Europe/London', created_at: '2026-01-01T00:00:00Z' },
  posts: [{ id: 'p1', platform: 'facebook', status: 'posted', content_variants: [{ body: 'Quiz night', media_ids: [] }] }],
  media: [],
  note: 'Download links expire 7 days after export.',
};

function request(options: { header?: boolean; accountId?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.header !== false) headers['x-cheers-export'] = '1';
  return new Request('http://localhost:3600/api/settings/data-export', {
    method: 'POST',
    headers,
    body: JSON.stringify({ accountId: 'accountId' in options ? options.accountId : BRAND }),
  });
}

/** A press a minute after the last one, once the previous claim has lapsed. */
async function pressLater(): Promise<Response> {
  vi.setSystemTime(new Date(Date.now() + A_MINUTE));
  return POST(request());
}

function context(role: 'owner' | 'member' = 'owner', isSuperAdmin = false) {
  return { user: { id: OWNER, email: 'owner@venue.test' }, supabase: SERVICE, accountId: BRAND, role, isSuperAdmin };
}

function downloads(): number {
  return current('owner_data_export', BRAND)?.count ?? 0;
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  windows.clear();
  limiterError = null;
  ownerRole = 'owner';
  ownerLookupError = null;
  mockAuth.mockResolvedValue(context());
  mockSwitch.mockResolvedValue('open');
  mockExport.mockResolvedValue(EXPORT);
  mockAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('owner export: the download', () => {
  it("sends the owner the operator's export file for their active brand, counted and recorded", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="cheers-export-${BRAND}.json"`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(brandExportFile(BRAND, EXPORT).json);

    expect(mockExport).toHaveBeenCalledWith(SERVICE, BRAND);
    const subject = { email: '', ip: '', accountId: BRAND };
    expect(mockPeek).toHaveBeenCalledWith('owner_data_export', subject);
    expect(mockConsume.mock.calls.map(([action]) => action)).toEqual(['owner_data_export_lock', 'owner_data_export_attempt', 'owner_data_export']);
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: OWNER,
      action: 'export_brand_data',
      targetAccountId: BRAND,
      detail: { kind: 'owner_download' },
    });
    // Claimed before the build; counted, then recorded, only once the file is ready.
    expect(mockConsume.mock.invocationCallOrder[0]).toBeLessThan(mockExport.mock.invocationCallOrder[0]!);
    expect(mockExport.mock.invocationCallOrder[0]).toBeLessThan(mockConsume.mock.invocationCallOrder[2]!);
    expect(mockConsume.mock.invocationCallOrder[2]).toBeLessThan(mockAudit.mock.invocationCallOrder[0]!);
    expect(downloads()).toBe(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('streams a large export in chunks rather than one body', async () => {
    const posts = Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, body: 'x'.repeat(200) }));
    mockExport.mockResolvedValue({ ...EXPORT, posts });
    const response = await POST(request());
    const reader = response.body!.getReader();
    let chunks = 0;
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
      chunks += 1;
    }
    expect(chunks).toBeGreaterThan(1);
  });
});

describe('owner export: bursts and the claim', () => {
  it('30 presses at once build one export, send one file and leave one record', async () => {
    windows.set(`owner_data_export:${BRAND}`, { count: 2, resetAt: NOW.getTime() + 3600_000 });
    const responses = await Promise.all(Array.from({ length: 30 }, () => POST(request())));

    expect(mockExport).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(responses.filter((response) => response.headers.get('content-disposition'))).toHaveLength(1);
    const refused = responses.filter((response) => response.status === 429);
    expect(refused).toHaveLength(29);
    expect(await errorOf(refused[0]!)).toBe('A download for this venue is already being prepared. Wait a minute and try again.');
    expect(downloads()).toBe(3);
  });

  it('a press while an export is still being built is told to wait, and builds nothing', async () => {
    let finish: (value: unknown) => void = () => {};
    mockExport.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const first = POST(request());
    await vi.waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));

    const second = await POST(request());
    expect(second.status).toBe(429);
    expect(await errorOf(second)).toMatch(/already being prepared/);
    expect(mockExport).toHaveBeenCalledTimes(1);

    finish(EXPORT);
    expect((await first).status).toBe(200);
  });

  it('exports cut off by the time limit are never counted as downloads, cannot run on without end, and alert', async () => {
    // Each of these builds never finishes, as when Vercel stops the function at 60 seconds.
    mockExport.mockImplementation(() => new Promise(() => {}));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      vi.setSystemTime(new Date(NOW.getTime() + attempt * A_MINUTE));
      void POST(request());
      await vi.waitFor(() => expect(mockExport).toHaveBeenCalledTimes(attempt + 1));
      // Within the minute, a retry is held back by the claim.
      expect((await POST(request())).status).toBe(429);
    }
    expect(downloads()).toBe(0);
    expect(mockAudit).not.toHaveBeenCalled();

    const eleventh = await pressLater();
    expect(eleventh.status).toBe(429);
    expect(await errorOf(eleventh)).toBe(
      'We could not prepare your download after several tries today. Please email peter@orangejelly.co.uk and we will send you a copy.',
    );
    expect(mockExport).toHaveBeenCalledTimes(10);
    expect(mockAlert).toHaveBeenCalledWith(
      'owner_export',
      expect.objectContaining({ message: expect.stringContaining('started 10 exports in this 24-hour window') }),
    );
  });
});

describe('owner export: the quota (3 per brand per 24-hour window)', () => {
  it('refuses a fourth download, saying when to try again, without claiming or building anything', async () => {
    for (let i = 0; i < 3; i += 1) expect((await pressLater()).status).toBe(200);
    mockExport.mockClear();
    mockConsume.mockClear();
    const response = await pressLater();
    expect(response.status).toBe(429);
    expect(await errorOf(response)).toMatch(/^You can download your data 3 times a day\. Please try again in \d+ hours?, or email peter@orangejelly\.co\.uk\.$/);
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('failed exports use up none of it: three failures, then the owner still gets three files', async () => {
    mockExport.mockRejectedValue(new Error('statement timeout'));
    for (let i = 0; i < 3; i += 1) expect((await pressLater()).status).toBe(500);
    expect(downloads()).toBe(0);
    expect(mockAudit).not.toHaveBeenCalled();

    mockExport.mockResolvedValue(EXPORT);
    for (let i = 0; i < 3; i += 1) expect((await pressLater()).status).toBe(200);
    expect((await pressLater()).status).toBe(429);
  });

  it('a file refused at the final count is not recorded or sent', async () => {
    windows.set(`owner_data_export:${BRAND}`, { count: 2, resetAt: NOW.getTime() + 3600_000 });
    // Another download is counted while this one is being built.
    mockExport.mockImplementationOnce(async () => {
      windows.set(`owner_data_export:${BRAND}`, { count: 3, resetAt: NOW.getTime() + 3600_000 });
      return EXPORT;
    });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('owner export: who may download', () => {
  it('refuses a member on the server, before any limit, read or record', async () => {
    mockAuth.mockResolvedValue(context('member'));
    ownerRole = 'member';
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/Only an owner of this venue/);
    expect(mockPeek).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('refuses a super-admin with no owner row: the implied owner role does not count (operators use Admin)', async () => {
    mockAuth.mockResolvedValue(context('owner', true));
    ownerRole = null;
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/Only an owner of this venue/);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('refuses while the sign-up switch is off, or on without billing enforcement, with no alert', async () => {
    for (const state of ['closed', 'enforcement_off'] as const) {
      mockSwitch.mockResolvedValue(state);
      const response = await POST(request());
      expect(response.status, state).toBe(404);
      expect(await errorOf(response)).toMatch(/not available yet.*peter@orangejelly\.co\.uk/);
    }
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('refuses when the switch cannot be read, and alerts', async () => {
    mockSwitch.mockResolvedValue('unavailable');
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('switch', expect.any(Error));
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('refuses a request without the export header (another site cannot start an export)', async () => {
    const response = await POST(request({ header: false }));
    expect(response.status).toBe(403);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('refuses when the active brand changed in another tab since the page loaded', async () => {
    for (const accountId of [OTHER_BRAND, undefined, 42]) {
      const response = await POST(request({ accountId }));
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatch(/switched venue/);
    }
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('a signed-out visitor is still redirected (the redirect is not swallowed)', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/auth/login;307;' });
    mockAuth.mockRejectedValue(redirect);
    await expect(POST(request())).rejects.toBe(redirect);
    expect(mockAlert).not.toHaveBeenCalled();
  });
});

describe('owner export: each failing dependency shows an error with our address and alerts', () => {
  it('the sign-in lookup (AuthDependencyError), with no personal data in the alert', async () => {
    mockAuth.mockRejectedValue(new AuthDependencyError('account_members lookup failed', { message: 'connection refused' }));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatch(/could not prepare your download.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: 'sign-in lookup: account_members lookup failed' }));
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('the owner lookup', async () => {
    ownerLookupError = { message: 'connection refused' };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('owner lookup') }));
  });

  it('the limiter', async () => {
    limiterError = new Error('auth_rate_limits read failed: connection refused');
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatch(/could not prepare your download.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('limiter') }));
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('the claim', async () => {
    mockConsume.mockRejectedValueOnce(new Error('consume_rate_limit failed: connection refused'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('limiter') }));
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('the download count after the build: nothing is sent or recorded', async () => {
    const real = mockConsume.getMockImplementation()!;
    mockConsume.mockImplementation(async (action, subject) => {
      if (action === 'owner_data_export') throw new Error('consume_rate_limit failed: connection refused');
      return real(action, subject);
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('limiter') }));
    mockConsume.mockImplementation(real);
  });

  it('building the export (a database read or media signing): not counted as a download', async () => {
    mockExport.mockRejectedValue(new Error('media signing failed: Bucket not found'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith(
      'owner_export',
      expect.objectContaining({ message: expect.stringContaining('media signing failed') }),
    );
    expect(mockAudit).not.toHaveBeenCalled();
    expect(downloads()).toBe(0);
  });

  it('recording the export: nothing is sent unrecorded', async () => {
    mockAudit.mockRejectedValue(new Error('insert failed'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await errorOf(response)).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('admin_audit') }));
  });
});
