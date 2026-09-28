import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthDependencyError } from '@/lib/auth/errors';

// POST /api/settings/data-export: the owner's "Download my data". Every
// dependency is stubbed; the file layout is the real brandExportFile, the one
// the operator's Admin export uses. The limiter is an in-memory stand-in for
// public.consume_rate_limit, so the quota is checked end to end.

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

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

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'unavailable'>>();
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

/** Fixed 24-hour windows, 3 per brand, like owner_data_export. */
const counts = new Map<string, number>();
let limiterError: Error | null = null;
const mockPeek = vi.fn(async (_action: string, subject: { accountId?: string }) => {
  if (limiterError) throw limiterError;
  return (counts.get(subject.accountId ?? '') ?? 0) >= 3 ? { status: 'limited', retryAfterSeconds: 5 * 3600 - 30 } : { status: 'allowed' };
});
const mockConsume = vi.fn(async (_action: string, subject: { accountId?: string }) => {
  if (limiterError) throw limiterError;
  const next = (counts.get(subject.accountId ?? '') ?? 0) + 1;
  counts.set(subject.accountId ?? '', next);
  return next > 3 ? { status: 'limited', retryAfterSeconds: 5 * 3600 - 30 } : { status: 'allowed' };
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

function context(role: 'owner' | 'member' = 'owner', isSuperAdmin = false) {
  return { user: { id: OWNER, email: 'owner@venue.test' }, supabase: SERVICE, accountId: BRAND, role, isSuperAdmin };
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.clearAllMocks();
  counts.clear();
  limiterError = null;
  ownerRole = 'owner';
  ownerLookupError = null;
  mockAuth.mockResolvedValue(context());
  mockSwitch.mockResolvedValue('open');
  mockExport.mockResolvedValue(EXPORT);
  mockAudit.mockResolvedValue(undefined);
});

describe('owner export: the download', () => {
  it("sends the owner the operator's export file for their active brand, recorded, then counted", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="cheers-export-${BRAND}.json"`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(brandExportFile(BRAND, EXPORT).json);

    expect(mockExport).toHaveBeenCalledWith(SERVICE, BRAND);
    expect(mockPeek).toHaveBeenCalledWith('owner_data_export', { email: '', ip: '', accountId: BRAND });
    expect(mockConsume).toHaveBeenCalledWith('owner_data_export', { email: '', ip: '', accountId: BRAND });
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: OWNER,
      action: 'export_brand_data',
      targetAccountId: BRAND,
      detail: { kind: 'owner_download' },
    });
    // Checked first, counted only once the file is built and on record.
    expect(mockPeek.mock.invocationCallOrder[0]).toBeLessThan(mockExport.mock.invocationCallOrder[0]!);
    expect(mockAudit.mock.invocationCallOrder[0]).toBeLessThan(mockConsume.mock.invocationCallOrder[0]!);
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

describe('owner export: the quota (3 per brand per 24-hour window)', () => {
  it('refuses a fourth export, saying when to try again, without building anything', async () => {
    for (let i = 0; i < 3; i += 1) expect((await POST(request())).status).toBe(200);
    mockExport.mockClear();
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await errorOf(response)).toBe(
      'You can download your data 3 times a day. Please try again in 5 hours, or email peter@orangejelly.co.uk.',
    );
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('failed exports use up none of it: three failures, then the owner still gets three files', async () => {
    mockExport.mockRejectedValue(new Error('statement timeout'));
    for (let i = 0; i < 3; i += 1) expect((await POST(request())).status).toBe(500);
    mockExport.mockResolvedValue(EXPORT);
    mockAudit.mockRejectedValueOnce(new Error('insert failed'));
    expect((await POST(request())).status).toBe(500);
    expect(counts.get(BRAND) ?? 0).toBe(0);

    for (let i = 0; i < 3; i += 1) expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(429);
  });

  it('a burst that passes the check together still lets no more than 3 files out', async () => {
    counts.set(BRAND, 2);
    const responses = await Promise.all([POST(request()), POST(request()), POST(request())]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 429, 429]);
    expect(responses.filter((response) => response.headers.get('content-disposition')).length).toBe(1);
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
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a super-admin with no owner row: the implied owner role does not count (operators use Admin)", async () => {
    mockAuth.mockResolvedValue(context('owner', true));
    ownerRole = null;
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/Only an owner of this venue/);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('refuses while the sign-up switch is off, with no alert', async () => {
    mockSwitch.mockResolvedValue('closed');
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toMatch(/not available yet.*peter@orangejelly\.co\.uk/);
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
    expect(mockAlert).toHaveBeenCalledWith(
      'owner_export',
      expect.objectContaining({ message: 'sign-in lookup: account_members lookup failed' }),
    );
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('the owner lookup', async () => {
    ownerLookupError = { message: 'connection refused' };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('owner lookup') }));
  });

  it('the limiter check', async () => {
    limiterError = new Error('auth_rate_limits read failed: connection refused');
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatch(/could not prepare your download.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('limiter') }));
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('the limiter count after the build: nothing is sent', async () => {
    mockConsume.mockRejectedValueOnce(new Error('consume_rate_limit failed: connection refused'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('limiter') }));
  });

  it('building the export (a database read or media signing)', async () => {
    mockExport.mockRejectedValue(new Error('media signing failed: Bucket not found'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith(
      'owner_export',
      expect.objectContaining({ message: expect.stringContaining('media signing failed') }),
    );
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('recording the export: nothing is sent unrecorded, and nothing is counted', async () => {
    mockAudit.mockRejectedValue(new Error('insert failed'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await errorOf(response)).toContain('peter@orangejelly.co.uk');
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('admin_audit') }));
    expect(mockConsume).not.toHaveBeenCalled();
  });
});
