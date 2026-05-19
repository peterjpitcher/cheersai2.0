import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks -- set up before importing modules under test
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
}));

const mockBuildOAuthRedirectUrl = vi.fn();
vi.mock('@/lib/connections/oauth', () => ({
  buildOAuthRedirectUrl: (...args: unknown[]) => mockBuildOAuthRedirectUrl(...args),
}));

const mockExchangeProviderAuthCode = vi.fn();
vi.mock('@/lib/connections/token-exchange', () => ({
  exchangeProviderAuthCode: (...args: unknown[]) => mockExchangeProviderAuthCode(...args),
}));

const mockStoreEncryptedToken = vi.fn();
vi.mock('@/lib/providers/token-helpers', () => ({
  storeEncryptedToken: (...args: unknown[]) => mockStoreEncryptedToken(...args),
}));

vi.mock('@/lib/supabase/errors', () => ({
  isSchemaMissingError: vi.fn(() => false),
}));

vi.mock('@/lib/connections/metadata', () => ({
  evaluateConnectionMetadata: vi.fn(() => ({ complete: true, missingKeys: [] })),
}));

vi.mock('@/lib/gbp/location-id', () => ({
  getGbpLocationIdValidationError: vi.fn(() => null),
  normalizeCanonicalGbpLocationId: vi.fn((v: string) => v),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authContext(overrides: Partial<{ accountId: string; user: { id: string } }> = {}) {
  return {
    accountId: overrides.accountId ?? 'acc-1',
    user: overrides.user ?? { id: 'user-1' },
    supabase: { from: mockFrom },
  };
}

/** Build a chainable mock for supabase .from().select().eq().is().lt().single/maybeSingle() */
function mockQueryChain(data: unknown, error: unknown = null) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>;
  chain.single = vi.fn().mockResolvedValue({ data, error });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.gt = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  return chain;
}

function mockInsertChain(data: unknown = null, error: unknown = null) {
  return {
    insert: vi.fn().mockResolvedValue({ data, error }),
  };
}

function mockUpdateChain(data: unknown = null, error: unknown = null) {
  // Needs to support .update().eq().eq() chains where the last call resolves
  const terminal = { data, error };
  const secondEq = vi.fn().mockResolvedValue(terminal);
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  const chain = {
    update: vi.fn().mockReturnValue({ eq: firstEq }),
    eq: firstEq,
  };
  return chain;
}

function mockUpsertChain(data: unknown[] | null = [{ id: 'conn-1' }], error: unknown = null) {
  const terminal = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: data?.[0] ?? null, error }),
    }),
  };
  return {
    upsert: vi.fn().mockReturnValue(terminal),
  };
}

function mockDeleteChain(error: unknown = null) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>;
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockResolvedValue({ error });
  chain.not = vi.fn().mockResolvedValue({ error });
  chain.eq = vi.fn().mockResolvedValue({ error });
  return chain;
}

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are established
// ---------------------------------------------------------------------------

const {
  initiateOAuthConnect,
  completeOAuthConnect,
  disconnectProvider,
} = await import('./actions');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initiateOAuthConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthContext.mockResolvedValue(authContext());
    mockBuildOAuthRedirectUrl.mockReturnValue('https://oauth.example.com/auth?state=test');
  });

  it('should insert state into oauth_states with provider and 10-min expiry', async () => {
    const insertMock = mockInsertChain();
    mockFrom.mockReturnValue(insertMock);

    const result = await initiateOAuthConnect('facebook');

    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('oauth_states');
    const insertCall = insertMock.insert.mock.calls[0][0];
    expect(insertCall).toHaveProperty('provider', 'facebook');
    expect(insertCall).toHaveProperty('state');
    // Expiry should be ~10 minutes in the future
    const expiresAt = new Date(insertCall.expires_at).getTime();
    const now = Date.now();
    expect(expiresAt).toBeGreaterThan(now);
    expect(expiresAt).toBeLessThanOrEqual(now + 11 * 60 * 1000);
  });

  it('should return redirect URL from buildOAuthRedirectUrl', async () => {
    mockFrom.mockReturnValue(mockInsertChain());
    mockBuildOAuthRedirectUrl.mockReturnValue('https://oauth.example.com/auth?state=abc');

    const result = await initiateOAuthConnect('instagram');

    expect(result.success).toBe(true);
    expect(result.redirectUrl).toBe('https://oauth.example.com/auth?state=abc');
    expect(mockBuildOAuthRedirectUrl).toHaveBeenCalledWith('instagram', expect.any(String));
  });
});

describe('completeOAuthConnect', () => {
  const validExchange = {
    accessToken: 'access-tok-123',
    refreshToken: 'refresh-tok-456',
    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    displayName: 'My Facebook Page',
    metadata: { pageId: 'page-123' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthContext.mockResolvedValue(authContext());
    mockExchangeProviderAuthCode.mockResolvedValue(validExchange);
    mockStoreEncryptedToken.mockResolvedValue(undefined);
  });

  it('should mark state as used, exchange code, and store tokens in vault for valid state', async () => {
    const oauthStateRow = {
      id: 'state-row-1',
      provider: 'facebook',
      used_at: null,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    // Track which table is queried
    const queryChain = mockQueryChain(oauthStateRow);
    const updateChain = mockUpdateChain();
    const upsertChain = mockUpsertChain();

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') {
        callCount++;
        // First call: select query for validation
        // Second call: update to mark used
        return callCount === 1 ? queryChain : updateChain;
      }
      if (table === 'social_connections') return upsertChain;
      return mockInsertChain(); // notifications fallback
    });

    const result = await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state-uuid');

    expect(result.success).toBe(true);
    expect(mockExchangeProviderAuthCode).toHaveBeenCalledWith('facebook', 'auth-code-123');
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'access', 'access-tok-123');
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'refresh', 'refresh-tok-456');
  });

  it('should return error for already-used state (replay prevention)', async () => {
    const usedState = {
      id: 'state-row-1',
      provider: 'facebook',
      used_at: new Date().toISOString(), // already used
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    // Return null because the query filters by used_at IS NULL
    const queryChain = mockQueryChain(null);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') return queryChain;
      return mockInsertChain();
    });

    const result = await completeOAuthConnect('facebook', 'auth-code-123', 'used-state-uuid');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
    expect(mockExchangeProviderAuthCode).not.toHaveBeenCalled();
  });

  it('should return error for expired state', async () => {
    // Expired state returns null because query filters by expires_at > now()
    const queryChain = mockQueryChain(null);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') return queryChain;
      return mockInsertChain();
    });

    const result = await completeOAuthConnect('facebook', 'auth-code-123', 'expired-state-uuid');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
    expect(mockExchangeProviderAuthCode).not.toHaveBeenCalled();
  });

  it('should return error for non-existent state (state fixation prevention)', async () => {
    const queryChain = mockQueryChain(null);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') return queryChain;
      return mockInsertChain();
    });

    const result = await completeOAuthConnect('instagram', 'auth-code-123', 'fake-state');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
    expect(mockStoreEncryptedToken).not.toHaveBeenCalled();
  });

  it('should store access token via storeEncryptedToken', async () => {
    const oauthStateRow = {
      id: 'state-row-1', provider: 'facebook',
      used_at: null, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') {
        callCount++;
        return callCount === 1 ? mockQueryChain(oauthStateRow) : mockUpdateChain();
      }
      if (table === 'social_connections') return mockUpsertChain();
      return mockInsertChain();
    });

    await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'access', 'access-tok-123');
  });

  it('should store refresh token when present', async () => {
    const oauthStateRow = {
      id: 'state-row-1', provider: 'gbp',
      used_at: null, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') {
        callCount++;
        return callCount === 1 ? mockQueryChain(oauthStateRow) : mockUpdateChain();
      }
      if (table === 'social_connections') return mockUpsertChain();
      return mockInsertChain();
    });

    await completeOAuthConnect('gbp', 'auth-code-123', 'valid-state');

    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'refresh', 'refresh-tok-456');
  });

  it('should NOT store refresh token when absent', async () => {
    mockExchangeProviderAuthCode.mockResolvedValue({
      ...validExchange,
      refreshToken: null,
    });
    const oauthStateRow = {
      id: 'state-row-1', provider: 'facebook',
      used_at: null, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') {
        callCount++;
        return callCount === 1 ? mockQueryChain(oauthStateRow) : mockUpdateChain();
      }
      if (table === 'social_connections') return mockUpsertChain();
      return mockInsertChain();
    });

    await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    // Only access token stored, no refresh
    expect(mockStoreEncryptedToken).toHaveBeenCalledTimes(1);
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'access', 'access-tok-123');
  });

  it('should upsert social_connections with v2 columns (metadata, platform_account_name, token_expires_at)', async () => {
    const oauthStateRow = {
      id: 'state-row-1', provider: 'facebook',
      used_at: null, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    const upsertMock = mockUpsertChain();
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'oauth_states') {
        callCount++;
        return callCount === 1 ? mockQueryChain(oauthStateRow) : mockUpdateChain();
      }
      if (table === 'social_connections') return upsertMock;
      return mockInsertChain();
    });

    await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    const upsertCall = upsertMock.upsert.mock.calls[0][0];
    expect(upsertCall).toHaveProperty('platform_account_name', 'My Facebook Page');
    expect(upsertCall).toHaveProperty('token_expires_at');
    expect(upsertCall).toHaveProperty('metadata');
    // Must NOT contain plaintext token columns
    expect(upsertCall).not.toHaveProperty('access_token');
    expect(upsertCall).not.toHaveProperty('refresh_token');
  });
});

describe('disconnectProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthContext.mockResolvedValue(authContext());
  });

  it('should update status to disconnected, not delete', async () => {
    const updateChain = mockUpdateChain();
    mockFrom.mockReturnValue(updateChain);

    const result = await disconnectProvider('facebook');

    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('social_connections');
    const updateCall = updateChain.update.mock.calls[0][0];
    expect(updateCall).toHaveProperty('status', 'disconnected');
  });
});
