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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authContext(overrides: Partial<{ accountId: string; user: { id: string }; role: 'owner' | 'member' }> = {}) {
  const accountId = overrides.accountId ?? 'acc-1';
  return {
    accountId,
    activeAccountId: accountId,
    user: overrides.user ?? { id: 'user-1' },
    supabase: { from: mockFrom },
    brands: [{ accountId, name: 'Test', timezone: 'Europe/London' }],
    isSuperAdmin: false,
    role: overrides.role ?? 'owner',
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

function mockCompleteOAuthFrom({
  oauthStateRow,
  upsertChain = mockUpsertChain(),
  existingConnection = null,
}: {
  oauthStateRow: unknown;
  upsertChain?: ReturnType<typeof mockUpsertChain>;
  existingConnection?: unknown;
}) {
  let oauthCalls = 0;
  let socialCalls = 0;

  mockFrom.mockImplementation((table: string) => {
    if (table === 'oauth_states') {
      oauthCalls++;
      // The state row now carries the initiating brand; inject a default so
      // existing fixtures (which predate account_id binding) resolve to acc-1.
      const row =
        oauthStateRow && typeof oauthStateRow === 'object' && !('account_id' in (oauthStateRow as object))
          ? { ...(oauthStateRow as object), account_id: 'acc-1' }
          : oauthStateRow;
      return oauthCalls === 1 ? mockQueryChain(row) : mockUpdateChain();
    }
    if (table === 'social_connections') {
      socialCalls++;
      if (socialCalls === 1) return mockQueryChain(existingConnection);
      if (socialCalls === 2) return upsertChain;
      return mockUpdateChain();
    }
    return mockInsertChain();
  });

  return { upsertChain };
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

    mockCompleteOAuthFrom({ oauthStateRow });

    const result = await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state-uuid');

    expect(result.success).toBe(true);
    expect(mockExchangeProviderAuthCode).toHaveBeenCalledWith(
      'facebook',
      'auth-code-123',
      { existingDisplayName: null, existingMetadata: null },
    );
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'access', 'access-tok-123');
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'refresh', 'refresh-tok-456');
  });

  it('should return error for already-used state (replay prevention)', async () => {
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
    mockCompleteOAuthFrom({ oauthStateRow });

    await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'access', 'access-tok-123');
  });

  it('should store refresh token when present', async () => {
    const oauthStateRow = {
      id: 'state-row-1', provider: 'instagram',
      used_at: null, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    mockCompleteOAuthFrom({ oauthStateRow });

    await completeOAuthConnect('instagram', 'auth-code-123', 'valid-state');

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
    mockCompleteOAuthFrom({ oauthStateRow });

    await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    // Only access token stored, no refresh
    expect(mockStoreEncryptedToken).toHaveBeenCalledTimes(1);
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('conn-1', 'access', 'access-tok-123');
  });

  it('should return an actionable error when token vault config is missing', async () => {
    mockStoreEncryptedToken.mockRejectedValue(
      new Error('Missing encryption key: TOKEN_VAULT_KEY environment variable is not set'),
    );
    const oauthStateRow = {
      id: 'state-row-1',
      provider: 'instagram',
      used_at: null,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    mockCompleteOAuthFrom({ oauthStateRow });

    const result = await completeOAuthConnect('instagram', 'auth-code-123', 'valid-state');

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOKEN_VAULT_KEY');
    expect(result.error).toContain('Supabase Edge Function secrets');
  });

  it('should upsert social_connections with v2 columns (metadata, platform_account_name, token_expires_at)', async () => {
    const oauthStateRow = {
      id: 'state-row-1', provider: 'facebook',
      used_at: null, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    const upsertMock = mockUpsertChain();
    mockCompleteOAuthFrom({ oauthStateRow, upsertChain: upsertMock });

    await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    const upsertCall = upsertMock.upsert.mock.calls[0][0];
    expect(upsertCall).toHaveProperty('provider', 'facebook');
    expect(upsertCall).toHaveProperty('status', 'needs_action');
    expect(upsertCall).toHaveProperty('platform_account_name', 'My Facebook Page');
    expect(upsertCall).toHaveProperty('token_expires_at');
    expect(upsertCall).toHaveProperty('metadata');
    // Must NOT contain plaintext token columns
    expect(upsertCall).not.toHaveProperty('access_token');
    expect(upsertCall).not.toHaveProperty('refresh_token');
  });
});

// ---------------------------------------------------------------------------
// In-memory store for disconnectProvider. It enforces the live rules
// (checked 2026-09-25) so a write the database would reject fails here too:
// social_connections_status_check allows only active, expiring, needs_action,
// and status and updated_at are NOT NULL.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const LIVE_STATUSES = ['active', 'expiring', 'needs_action'];
const NOT_NULL: Record<string, string[]> = {
  social_connections: ['id', 'account_id', 'provider', 'status', 'created_at', 'updated_at'],
  token_vault: ['id', 'social_connection_id', 'token_type', 'ciphertext', 'iv', 'tag'],
};

let memDb: Record<string, Row[]>;
let failures: Partial<Record<string, { op: 'select' | 'update' | 'delete'; message: string }>>;
let rejectedWrites: Array<{ table: string; code: string }>;

function violation(table: string, patch: Row): { code: string; message: string } | null {
  for (const column of NOT_NULL[table] ?? []) {
    if (column in patch && patch[column] === null) {
      return { code: '23502', message: `null value in column "${column}" of relation "${table}" violates not-null constraint` };
    }
  }
  if (table === 'social_connections' && 'status' in patch && !LIVE_STATUSES.includes(patch.status as string)) {
    return { code: '23514', message: 'new row for relation "social_connections" violates check constraint "social_connections_status_check"' };
  }
  return null;
}

interface MemResult {
  data: Row[] | null;
  error: { code?: string; message: string } | null;
}

interface MemQuery {
  select: () => MemQuery;
  update: (patch: Row) => MemQuery;
  delete: () => MemQuery;
  eq: (column: string, value: unknown) => MemQuery;
  in: (column: string, values: unknown[]) => MemQuery;
  then: (resolve: (result: MemResult) => unknown) => unknown;
}

function memQuery(table: string): MemQuery {
  let op: 'select' | 'update' | 'delete' = 'select';
  let patch: Row = {};
  const preds: Array<(r: Row) => boolean> = [];
  const run = (): MemResult => {
    const injected = failures[table];
    if (injected && injected.op === op) return { data: null, error: { message: injected.message } };
    const rows = (memDb[table] ?? []).filter((r) => preds.every((p) => p(r)));
    if (op === 'update') {
      const error = violation(table, patch);
      if (error) {
        rejectedWrites.push({ table, code: error.code });
        return { data: null, error };
      }
      rows.forEach((r) => Object.assign(r, patch));
      return { data: rows, error: null };
    }
    if (op === 'delete') {
      memDb[table] = (memDb[table] ?? []).filter((r) => !preds.every((p) => p(r)));
      return { data: null, error: null };
    }
    return { data: rows, error: null };
  };
  const q: MemQuery = {
    select: () => q,
    update: (p) => {
      op = 'update';
      patch = p;
      return q;
    },
    delete: () => {
      op = 'delete';
      return q;
    },
    eq: (c, v) => {
      preds.push((r) => r[c] === v);
      return q;
    },
    in: (c, vs) => {
      preds.push((r) => vs.includes(r[c]));
      return q;
    },
    then: (resolve) => resolve(run()),
  };
  return q;
}

function connection(id: string, accountId: string, provider: string): Row {
  return {
    id,
    account_id: accountId,
    provider,
    status: 'active',
    access_token: `plain-${id}`,
    refresh_token: `refresh-${id}`,
    token_expires_at: '2026-11-01T00:00:00Z',
    expires_at: '2026-11-01T00:00:00Z',
    metadata: { pageId: '123' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function vaultRow(id: string, connectionId: string, tokenType: 'access' | 'refresh'): Row {
  return { id, social_connection_id: connectionId, token_type: tokenType, ciphertext: 'c', iv: 'i', tag: 't', key_version: 1 };
}

describe('disconnectProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthContext.mockResolvedValue(authContext());
    failures = {};
    rejectedWrites = [];
    memDb = {
      social_connections: [
        connection('fb-1', 'acc-1', 'facebook'),
        connection('ig-1', 'acc-1', 'instagram'),
        connection('fb-other', 'acc-2', 'facebook'),
      ],
      token_vault: [
        vaultRow('v-fb-access', 'fb-1', 'access'),
        vaultRow('v-fb-refresh', 'fb-1', 'refresh'),
        vaultRow('v-ig-access', 'ig-1', 'access'),
        vaultRow('v-other-access', 'fb-other', 'access'),
      ],
    };
    mockFrom.mockImplementation((table: string) => memQuery(table));
  });

  const row = (id: string) => memDb.social_connections.find((r) => r.id === id);
  const vaultIds = () => memDb.token_vault.map((r) => r.id);

  it('the store rejects the status the old code wrote, as the live CHECK does', async () => {
    const result = await memQuery('social_connections').update({ status: 'disconnected' }).eq('id', 'fb-1');

    expect(result.error?.code).toBe('23514');
    expect(row('fb-1')?.status).toBe('active');
  });

  it('writes needs_action and deletes every stored token for that provider only', async () => {
    const result = await disconnectProvider('facebook');

    expect(result).toEqual({ success: true });
    expect(rejectedWrites).toEqual([]);
    expect(row('fb-1')).toMatchObject({
      status: 'needs_action',
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      expires_at: null,
      metadata: { pageId: '123' },
    });
    expect(row('fb-1')?.updated_at).not.toBe('2026-01-01T00:00:00Z');
    expect(vaultIds()).toEqual(['v-ig-access', 'v-other-access']);

    // The brand's other provider and another brand's Facebook are untouched.
    expect(row('ig-1')).toMatchObject({ status: 'active', access_token: 'plain-ig-1' });
    expect(row('fb-other')).toMatchObject({ status: 'active', access_token: 'plain-fb-other' });
  });

  it('succeeds without writing when the brand has no connection for that provider', async () => {
    memDb.social_connections = memDb.social_connections.filter((r) => r.id !== 'ig-1');

    const result = await disconnectProvider('instagram');

    expect(result).toEqual({ success: true });
    expect(vaultIds()).toContain('v-ig-access');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('fails visibly and deletes nothing when the connection lookup fails', async () => {
    failures.social_connections = { op: 'select', message: 'connection reset' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await disconnectProvider('facebook');

    expect(result).toEqual({ success: false, error: 'Failed to disconnect provider' });
    expect(vaultIds()).toHaveLength(4);
    expect(row('fb-1')).toMatchObject({ status: 'active', access_token: 'plain-fb-1' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('fails visibly, and never reports success, when the token_vault delete fails', async () => {
    failures.token_vault = { op: 'delete', message: 'permission denied for table token_vault' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await disconnectProvider('facebook');

    expect(result).toEqual({ success: false, error: 'Failed to disconnect provider' });
    expect(vaultIds()).toContain('v-fb-access');
    expect(row('fb-1')).toMatchObject({ status: 'active', access_token: 'plain-fb-1' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('fails visibly when the connection update fails after the vault delete', async () => {
    failures.social_connections = { op: 'update', message: 'statement timeout' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await disconnectProvider('facebook');

    expect(result).toEqual({ success: false, error: 'Failed to disconnect provider' });
    expect(row('fb-1')?.access_token).toBe('plain-fb-1');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('owner-only connections (decision D4)', () => {
  it('refuses members before touching the database', async () => {
    mockRequireAuthContext.mockResolvedValue(authContext({ role: 'member' }));
    mockFrom.mockClear();

    await expect(disconnectProvider('facebook')).rejects.toThrow('Only an owner of this brand can do that.');
    await expect(initiateOAuthConnect('facebook')).rejects.toThrow('Only an owner of this brand can do that.');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
