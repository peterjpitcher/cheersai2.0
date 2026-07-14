import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: mockRequireAuthContext,
}));

const mockLogAdminEvent = vi.fn();
vi.mock('@/lib/admin/audit', () => ({
  logAdminEvent: (...args: unknown[]) => mockLogAdminEvent(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Configurable service-client responses.
const state = {
  accountsInsert: { data: { id: 'brand-1' } as { id: string } | null, error: null as unknown },
  appAdminsCount: { count: 2 as number | null, error: null as unknown },
  mutationError: null as unknown,
};

function buildSupabase() {
  const b: Record<string, unknown> = {};
  b.insert = () => b;
  b.upsert = () => Promise.resolve({ error: state.mutationError });
  b.select = (_cols?: string, opts?: { head?: boolean }) => {
    if (opts?.head) return Promise.resolve(state.appAdminsCount);
    return b;
  };
  b.single = () => Promise.resolve(state.accountsInsert);
  b.delete = () => b;
  b.eq = () => b;
  b.then = (resolve: (v: unknown) => unknown) => resolve({ error: state.mutationError });
  return { from: () => b };
}

const SUPER_ADMIN_CTX = {
  user: { id: '11111111-1111-1111-1111-111111111111' },
  supabase: buildSupabase(),
  accountId: 'acc-1',
  activeAccountId: 'acc-1',
  brands: [],
  isSuperAdmin: true,
};

const A_USER = '22222222-2222-4222-8222-222222222222';
const A_BRAND = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  state.accountsInsert = { data: { id: 'brand-1' }, error: null };
  state.appAdminsCount = { count: 2, error: null };
  state.mutationError = null;
  mockRequireAuthContext.mockResolvedValue({ ...SUPER_ADMIN_CTX, supabase: buildSupabase() });
});

describe('admin actions — authorization', () => {
  it('returns Forbidden when the caller is not a super-admin', async () => {
    mockRequireAuthContext.mockResolvedValue({ ...SUPER_ADMIN_CTX, isSuperAdmin: false, supabase: buildSupabase() });
    const { createBrand, assignMembership, setSuperAdmin } = await import('./actions');
    expect(await createBrand({ name: 'X', email: 'x@y.com' })).toEqual({ error: 'Forbidden.' });
    expect(await assignMembership(A_USER, A_BRAND)).toEqual({ error: 'Forbidden.' });
    expect(await setSuperAdmin(A_USER, true)).toEqual({ error: 'Forbidden.' });
  });
});

describe('createBrand', () => {
  it('creates a brand and audits it', async () => {
    const { createBrand } = await import('./actions');
    const result = await createBrand({ name: 'The Anchor', email: 'hi@anchor.pub', timezone: 'Europe/London' });
    expect(result).toEqual({ success: true });
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create_brand', targetAccountId: 'brand-1' }),
    );
  });

  it('rejects a blank name', async () => {
    const { createBrand } = await import('./actions');
    const result = await createBrand({ name: '  ', email: 'hi@anchor.pub' });
    expect(result.error).toBeDefined();
    expect(result.success).toBeUndefined();
  });

  it('rejects an invalid timezone', async () => {
    const { createBrand } = await import('./actions');
    const result = await createBrand({ name: 'X', email: 'hi@anchor.pub', timezone: 'Mars/Olympus' });
    expect(result.error).toBe('Invalid timezone');
  });
});

describe('setSuperAdmin — last-admin protection', () => {
  it('blocks removing the last administrator', async () => {
    state.appAdminsCount = { count: 1, error: null };
    const { setSuperAdmin } = await import('./actions');
    const result = await setSuperAdmin(A_USER, false);
    expect(result).toEqual({ error: 'Cannot remove the last administrator.' });
    expect(mockLogAdminEvent).not.toHaveBeenCalled();
  });

  it('allows removing an admin when others remain', async () => {
    state.appAdminsCount = { count: 3, error: null };
    const { setSuperAdmin } = await import('./actions');
    const result = await setSuperAdmin(A_USER, false);
    expect(result).toEqual({ success: true });
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'revoke_admin', targetUserId: A_USER }),
    );
  });

  it('grants admin', async () => {
    const { setSuperAdmin } = await import('./actions');
    const result = await setSuperAdmin(A_USER, true);
    expect(result).toEqual({ success: true });
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'grant_admin', targetUserId: A_USER }),
    );
  });
});

describe('membership', () => {
  it('rejects non-uuid ids', async () => {
    const { assignMembership } = await import('./actions');
    expect(await assignMembership('not-a-uuid', A_BRAND)).toEqual({ error: 'Invalid user or brand.' });
  });

  it('assigns membership and audits it', async () => {
    const { assignMembership } = await import('./actions');
    const result = await assignMembership(A_USER, A_BRAND);
    expect(result).toEqual({ success: true });
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assign_member', targetUserId: A_USER, targetAccountId: A_BRAND }),
    );
  });
});
