import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthDependencyError } from '@/lib/auth/errors';

// POST /api/admin/brand-export: the operator's Admin "Export data", now a
// streamed download. The checks and the admin_audit record must match the
// server action it replaces (super-admin only, "Invalid brand.", audit with
// actor and brand and no detail, "The export failed. Try again.").

const BRAND = '11111111-1111-4111-8111-111111111111';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const SERVICE = { tag: 'service-client' };

const mockAuth = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockAuth() }));

const mockExport = vi.fn();
vi.mock('@/lib/admin/offboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/offboarding')>()),
  exportBrandData: (...args: unknown[]) => mockExport(...args),
}));

const mockAudit = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockAudit(...args) }));

const mockAlert = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/signup/alerts', () => ({ reportSignupFailure: (...args: unknown[]) => mockAlert(...args) }));

const mockLogError = vi.fn();
vi.mock('@/lib/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => mockLogError(...args) }),
}));

const { POST } = await import('./route');
const { brandExportFile } = await import('@/lib/admin/offboarding');

const EXPORT = {
  exportedAt: '2026-09-28T12:00:00.000Z',
  brand: { business_name: 'The Test Arms' },
  posts: [{ id: 'p1', status: 'posted' }],
  media: [],
};

function request(options: { header?: boolean; accountId?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.header !== false) headers['x-cheers-export'] = '1';
  return new Request('http://localhost:3600/api/admin/brand-export', {
    method: 'POST',
    headers,
    body: JSON.stringify({ accountId: 'accountId' in options ? options.accountId : BRAND }),
  });
}

function context(isSuperAdmin: boolean) {
  return { user: { id: ADMIN }, supabase: SERVICE, accountId: '99999999-9999-4999-8999-999999999999', role: 'owner', isSuperAdmin };
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(context(true));
  mockExport.mockResolvedValue(EXPORT);
  mockAudit.mockResolvedValue(undefined);
});

describe('Admin export route', () => {
  it('streams the operator the same file as before, for any brand, recorded exactly as before', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="cheers-export-${BRAND}.json"`);
    expect(await response.text()).toBe(brandExportFile(BRAND, EXPORT).json);
    expect(mockExport).toHaveBeenCalledWith(SERVICE, BRAND);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith({ actorUserId: ADMIN, action: 'export_brand_data', targetAccountId: BRAND });
  });

  it('is super-admin only: an owner or member of the brand gets "Forbidden." and nothing is read or recorded', async () => {
    mockAuth.mockResolvedValue(context(false));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('Forbidden.');
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('refuses a request without the export header (another site cannot start one)', async () => {
    const response = await POST(request({ header: false }));
    expect(response.status).toBe(403);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('refuses a brand id that is not a UUID', async () => {
    for (const accountId of ['not-a-uuid', '', 42, undefined]) {
      const response = await POST(request({ accountId }));
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe('Invalid brand.');
    }
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('a failed export is logged, answered "The export failed. Try again.", and not recorded', async () => {
    mockExport.mockRejectedValue(new Error('media signing failed: Bucket not found'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe('The export failed. Try again.');
    expect(mockLogError).toHaveBeenCalledWith('export brand data failed', expect.any(Error), { accountId: BRAND });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('a failed sign-in lookup (AuthDependencyError) answers the usual error and alerts, with no personal data', async () => {
    mockAuth.mockRejectedValue(new AuthDependencyError('app_admins lookup failed', { message: 'connection refused' }));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('The export failed. Try again.');
    expect(mockAlert).toHaveBeenCalledWith('admin_export', expect.objectContaining({ message: 'sign-in lookup: app_admins lookup failed' }));
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('a signed-out visitor is still redirected (the redirect is not swallowed)', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/auth/login;307;' });
    mockAuth.mockRejectedValue(redirect);
    await expect(POST(request())).rejects.toBe(redirect);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('an export that cannot be recorded is not sent', async () => {
    mockAudit.mockRejectedValue(new Error('insert failed'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await errorOf(response)).toBe('The export failed. Try again.');
    expect(mockLogError).toHaveBeenCalledWith('export brand data failed', expect.any(Error), { accountId: BRAND });
  });
});
