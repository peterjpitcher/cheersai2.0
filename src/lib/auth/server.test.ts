import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks -- set up before importing modules under test
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

// Service-role client mock: dispatches per table to a preset response. The
// returned builder is both chainable (select/eq/in/is/order) and awaitable, and
// exposes maybeSingle() for single-row reads.
const serviceResponses: Record<string, { data: unknown; error: unknown }> = {};

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.in = chain;
  builder.is = chain;
  builder.order = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  // Thenable so `await service.from(t).select()...` resolves to the response.
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
}

const mockServiceFrom = vi.fn((table: string) =>
  makeBuilder(serviceResponses[table] ?? { data: null, error: null }),
);

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({ from: mockServiceFrom })),
}));

// Active-brand cookie
const mockCookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookieGet })),
}));

// redirect throws NEXT_REDIRECT like the real one
const mockRedirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ACC_A = '22222222-2222-2222-2222-222222222222';
const ACC_B = '33333333-3333-3333-3333-333333333333';

const AUTH_USER = { id: USER_ID, email: 'owner@pub.com', app_metadata: {}, user_metadata: {} };

function setUser(user: unknown): void {
  mockGetUser.mockResolvedValue({ data: { user }, error: null });
}

function setSuperAdmin(isAdmin: boolean): void {
  serviceResponses['app_admins'] = { data: isAdmin ? { user_id: USER_ID } : null, error: null };
}

function setMemberships(accountIds: string[]): void {
  serviceResponses['account_members'] = {
    data: accountIds.map((id) => ({ account_id: id })),
    error: null,
  };
}

function setAccounts(rows: Array<{ id: string; business_name: string | null; timezone: string | null }>): void {
  serviceResponses['accounts'] = { data: rows, error: null };
}

function setCookie(value: string | null): void {
  mockCookieGet.mockReturnValue(value ? { value } : undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(serviceResponses)) delete serviceResponses[key];
  setSuperAdmin(false);
  setMemberships([]);
  setAccounts([]);
  setCookie(null);
});

// ---------------------------------------------------------------------------
// getCurrentUser
// ---------------------------------------------------------------------------

describe('getCurrentUser', () => {
  it('returns null when there is no authenticated user', async () => {
    setUser(null);
    const { getCurrentUser } = await import('@/lib/auth/server');
    expect(await getCurrentUser()).toBeNull();
  });

  it('resolves the single membership brand as active when no cookie is set', async () => {
    setUser(AUTH_USER);
    setMemberships([ACC_A]);
    setAccounts([{ id: ACC_A, business_name: 'The Crown', timezone: 'Europe/London' }]);

    const { getCurrentUser } = await import('@/lib/auth/server');
    const user = await getCurrentUser();

    expect(user).not.toBeNull();
    expect(user!.activeAccountId).toBe(ACC_A);
    expect(user!.accountId).toBe(ACC_A);
    expect(user!.businessName).toBe('The Crown');
    expect(user!.brands).toHaveLength(1);
    expect(user!.isSuperAdmin).toBe(false);
  });

  it('honours a valid active-brand cookie among several memberships', async () => {
    setUser(AUTH_USER);
    setMemberships([ACC_A, ACC_B]);
    setAccounts([
      { id: ACC_A, business_name: 'Alpha', timezone: 'Europe/London' },
      { id: ACC_B, business_name: 'Bravo', timezone: 'Europe/London' },
    ]);
    setCookie(ACC_B);

    const { getCurrentUser } = await import('@/lib/auth/server');
    const user = await getCurrentUser();

    expect(user!.activeAccountId).toBe(ACC_B);
    expect(user!.brands).toHaveLength(2);
  });

  it('falls back to the first brand when the cookie points at a non-member brand', async () => {
    setUser(AUTH_USER);
    setMemberships([ACC_A]);
    setAccounts([{ id: ACC_A, business_name: 'Alpha', timezone: 'Europe/London' }]);
    setCookie(ACC_B); // not a membership

    const { getCurrentUser } = await import('@/lib/auth/server');
    const user = await getCurrentUser();

    expect(user!.activeAccountId).toBe(ACC_A);
  });

  it('returns a zero-brand user (activeAccountId null) with no memberships', async () => {
    setUser(AUTH_USER);
    setMemberships([]);

    const { getCurrentUser } = await import('@/lib/auth/server');
    const user = await getCurrentUser();

    expect(user).not.toBeNull();
    expect(user!.activeAccountId).toBeNull();
    expect(user!.accountId).toBeNull();
    expect(user!.brands).toHaveLength(0);
  });

  it('gives a super-admin every non-archived brand (god-mode)', async () => {
    setUser(AUTH_USER);
    setSuperAdmin(true);
    setMemberships([]); // no explicit memberships
    setAccounts([
      { id: ACC_A, business_name: 'Alpha', timezone: 'Europe/London' },
      { id: ACC_B, business_name: 'Bravo', timezone: 'Europe/London' },
    ]);

    const { getCurrentUser } = await import('@/lib/auth/server');
    const user = await getCurrentUser();

    expect(user!.isSuperAdmin).toBe(true);
    expect(user!.brands).toHaveLength(2);
    expect(user!.activeAccountId).toBe(ACC_A);
  });

  it('throws AuthDependencyError (not a logout) when a membership query fails', async () => {
    setUser(AUTH_USER);
    serviceResponses['account_members'] = { data: null, error: { message: 'db down' } };

    const { getCurrentUser } = await import('@/lib/auth/server');
    const { AuthDependencyError } = await import('@/lib/auth/errors');
    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthDependencyError);
  });
});

// ---------------------------------------------------------------------------
// requireAuthContext
// ---------------------------------------------------------------------------

describe('requireAuthContext', () => {
  it('redirects to /auth/login when unauthenticated', async () => {
    setUser(null);
    const { requireAuthContext } = await import('@/lib/auth/server');
    await expect(requireAuthContext()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
  });

  it('redirects to /no-access when authenticated but brand-less', async () => {
    setUser(AUTH_USER);
    setMemberships([]);
    const { requireAuthContext } = await import('@/lib/auth/server');
    await expect(requireAuthContext()).rejects.toThrow('NEXT_REDIRECT:/no-access');
  });

  it('returns an AuthContext with the active brand for a member', async () => {
    setUser(AUTH_USER);
    setMemberships([ACC_A]);
    setAccounts([{ id: ACC_A, business_name: 'The Crown', timezone: 'Europe/London' }]);

    const { requireAuthContext } = await import('@/lib/auth/server');
    const ctx = await requireAuthContext();

    expect(ctx.accountId).toBe(ACC_A);
    expect(ctx.activeAccountId).toBe(ACC_A);
    expect(ctx.user.id).toBe(USER_ID);
    expect(ctx.supabase).toBeDefined();
    expect(ctx.isSuperAdmin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rate limit (unchanged behaviour)
// ---------------------------------------------------------------------------

describe('checkAuthRateLimit', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('allows in the dev fallback when Upstash is not configured', async () => {
    const { checkAuthRateLimit } = await import('@/lib/auth/rate-limit');
    const result = await checkAuthRateLimit('test@example.com');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(5);
    expect(result.remaining).toBe(5);
  });
});
