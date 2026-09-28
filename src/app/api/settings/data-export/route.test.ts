import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/settings/data-export: the owner's "Download my data". Every
// dependency is stubbed; the file layout is the real brandExportFile, the one
// the operator's Admin export uses.

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const SERVICE = { tag: 'service-client' };

const mockAuth = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockAuth() }));

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'unavailable'>>();
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

const mockLimit = vi.fn();
vi.mock('@/lib/auth/rate-limit', () => ({ consumeAuthRateLimit: (...args: unknown[]) => mockLimit(...args) }));

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

function owner(role: 'owner' | 'member' = 'owner') {
  return { user: { id: OWNER, email: 'owner@venue.test' }, supabase: SERVICE, accountId: BRAND, role };
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(owner());
  mockSwitch.mockResolvedValue('open');
  mockLimit.mockResolvedValue({ status: 'allowed' });
  mockExport.mockResolvedValue(EXPORT);
  mockAudit.mockResolvedValue(undefined);
});

describe('owner export: the download', () => {
  it("sends the owner the operator's export file for their active brand, recorded first", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="cheers-export-${BRAND}.json"`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(brandExportFile(BRAND, EXPORT).json);
    expect(brandExportFile(BRAND, EXPORT).json).toBe(JSON.stringify(EXPORT, null, 2));

    expect(mockExport).toHaveBeenCalledWith(SERVICE, BRAND);
    expect(mockLimit).toHaveBeenCalledWith('owner_data_export', { email: '', ip: '', accountId: BRAND });
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: OWNER,
      action: 'export_brand_data',
      targetAccountId: BRAND,
      detail: { kind: 'owner_download' },
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('streams a large export in chunks rather than one body', async () => {
    const posts = Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, body: 'x'.repeat(200) }));
    mockExport.mockResolvedValue({ ...EXPORT, posts });
    const response = await POST(request());
    const reader = response.body!.getReader();
    let chunks = 0;
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      bytes += value.byteLength;
    }
    expect(chunks).toBeGreaterThan(1);
    expect(bytes).toBe(new TextEncoder().encode(JSON.stringify({ ...EXPORT, posts }, null, 2)).byteLength);
  });
});

describe('owner export: who may download', () => {
  it('refuses a member on the server, before any limit, read or record', async () => {
    mockAuth.mockResolvedValue(owner('member'));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/Only an owner of this venue/);
    expect(mockLimit).not.toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
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

  it('refuses a request without the Settings header (another site cannot start an export)', async () => {
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

  it('refuses a fourth export in a day, saying when to try again, with no alert', async () => {
    mockLimit.mockResolvedValue({ status: 'limited', retryAfterSeconds: 5 * 3600 - 30 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await errorOf(response)).toBe(
      'You can download your data 3 times a day. Please try again in 5 hours, or email peter@orangejelly.co.uk.',
    );
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});

describe('owner export: each failing dependency shows an error with our address and alerts', () => {
  it('the limiter', async () => {
    mockLimit.mockRejectedValue(new Error('consume_rate_limit failed: connection refused'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatch(/could not prepare your download.*peter@orangejelly\.co\.uk/);
    expect(mockAlert).toHaveBeenCalledWith('owner_export', expect.objectContaining({ message: expect.stringContaining('limiter') }));
    expect(mockExport).not.toHaveBeenCalled();
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
