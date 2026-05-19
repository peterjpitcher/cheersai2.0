import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks -- set up before importing modules under test
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

const mockServiceFrom = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    from: mockServiceFrom,
  })),
}));

vi.mock('@/lib/supabase/errors', () => ({
  isSchemaMissingError: vi.fn(() => false),
}));

// Mock next/navigation redirect -- throws NEXT_REDIRECT like the real one
const mockRedirect = vi.fn(() => {
  throw new Error('NEXT_REDIRECT');
});
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

// Mock server-only (no-op in tests)
vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAccountQuery(account: Record<string, unknown> | null): void {
  const chainResult = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: account,
      error: null,
    }),
  };
  const eqResult = { ...chainResult };
  const selectResult = { eq: vi.fn().mockReturnValue(eqResult) };
  mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue(selectResult) });
}

function mockServiceAccountQuery(account: Record<string, unknown> | null): void {
  const chainResult = {
    maybeSingle: vi.fn().mockResolvedValue({
      data: account,
      error: null,
    }),
  };
  const eqResult = { ...chainResult };
  const selectResult = { eq: vi.fn().mockReturnValue(eqResult) };
  mockServiceFrom.mockReturnValue({ select: vi.fn().mockReturnValue(selectResult) });
}

const MOCK_USER_ID = '11111111-1111-1111-1111-111111111111';
const MOCK_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';

const MOCK_AUTH_USER = {
  id: MOCK_USER_ID,
  email: 'owner@pub.com',
  app_metadata: { account_id: MOCK_ACCOUNT_ID },
  user_metadata: {},
};

const MOCK_ACCOUNT_ROW = {
  id: MOCK_ACCOUNT_ID,
  email: 'owner@pub.com',
  business_name: 'The Crown',
  timezone: 'Europe/London',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when supabase.auth.getUser() returns no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const { getCurrentUser } = await import('@/lib/auth/server');
    const result = await getCurrentUser();
    expect(result).toBeNull();
  });

  it('should return AppUser when getUser returns a valid user and account exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: MOCK_AUTH_USER }, error: null });
    mockAccountQuery(MOCK_ACCOUNT_ROW);

    const { getCurrentUser } = await import('@/lib/auth/server');
    const result = await getCurrentUser();

    expect(result).not.toBeNull();
    expect(result!.id).toBe(MOCK_USER_ID);
    expect(result!.email).toBe('owner@pub.com');
    expect(result!.accountId).toBe(MOCK_ACCOUNT_ID);
    expect(result!.businessName).toBe('The Crown');
    expect(result!.timezone).toBe('Europe/London');
  });
});

describe('requireAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw redirect when getCurrentUser returns null', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const { requireAuthContext } = await import('@/lib/auth/server');
    await expect(requireAuthContext()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/login');
  });

  it('should return AuthContext with user and supabase client when authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: MOCK_AUTH_USER }, error: null });
    mockAccountQuery(MOCK_ACCOUNT_ROW);

    const { requireAuthContext } = await import('@/lib/auth/server');
    const ctx = await requireAuthContext();

    expect(ctx.user).toBeDefined();
    expect(ctx.user.id).toBe(MOCK_USER_ID);
    expect(ctx.user.accountId).toBe(MOCK_ACCOUNT_ID);
    expect(ctx.supabase).toBeDefined();
    expect(ctx.accountId).toBe(MOCK_ACCOUNT_ID);
  });
});

describe('checkAuthRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure Upstash env vars are not set so the dev fallback kicks in
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('should return allowed: true when UPSTASH_REDIS_REST_URL is not set (dev fallback)', async () => {
    const { checkAuthRateLimit } = await import('@/lib/auth/rate-limit');
    const result = await checkAuthRateLimit('test@example.com');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(5);
    expect(result.remaining).toBe(5);
  });
});
