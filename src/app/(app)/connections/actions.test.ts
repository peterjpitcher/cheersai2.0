import { randomBytes } from 'node:crypto';

import { redirect } from 'next/navigation';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ManagedPage } from '@/lib/connections/page-selection';
import { InMemoryConnectionsDb } from '../../../../tests/helpers/in-memory-connections-db';

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
vi.mock('@/lib/connections/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/connections/oauth')>()),
  buildOAuthRedirectUrl: (...args: unknown[]) => mockBuildOAuthRedirectUrl(...args),
}));

// Meta is never called: the login and the Page list are stubbed, the rest is real.
const mockExchangeCodeForUserToken = vi.fn();
const mockFetchManagedPages = vi.fn();
vi.mock('@/lib/connections/token-exchange', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/connections/token-exchange')>()),
  exchangeCodeForUserToken: (...args: unknown[]) => mockExchangeCodeForUserToken(...args),
  fetchManagedPages: (...args: unknown[]) => mockFetchManagedPages(...args),
}));

const mockStoreEncryptedToken = vi.fn();
vi.mock('@/lib/providers/token-helpers', () => ({
  storeEncryptedToken: (...args: unknown[]) => mockStoreEncryptedToken(...args),
}));

vi.mock('@/lib/supabase/errors', () => ({
  isSchemaMissingError: vi.fn(() => false),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
// Supabase auth user ids are uuids, and oauth_states.created_by is a uuid column.
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_TOKEN = 'EAAB-user-token-never-shown';

type Role = 'owner' | 'member';

function authContext(
  overrides: Partial<{ accountId: string; user: { id: string }; role: Role; brands: Array<{ accountId: string; role: Role }> }> = {},
) {
  const accountId = overrides.accountId ?? ACCOUNT;
  const role = overrides.role ?? 'owner';
  const brands = (overrides.brands ?? [{ accountId, role }]).map((brand) => ({
    ...brand,
    name: 'Test',
    timezone: 'Europe/London',
  }));
  return {
    accountId,
    activeAccountId: accountId,
    user: overrides.user ?? { id: USER_ID },
    supabase: { from: mockFrom },
    brands,
    isSuperAdmin: false,
    role,
  };
}

function mockInsertChain(data: unknown = null, error: unknown = null) {
  return {
    insert: vi.fn().mockResolvedValue({ data, error }),
  };
}

function page(id: string, overrides: Partial<ManagedPage> = {}): ManagedPage {
  return {
    id,
    name: `Page ${id}`,
    accessToken: `page-token-${id}`,
    tasks: ['CREATE_CONTENT', 'MODERATE', 'MANAGE'],
    instagram: null,
    ...overrides,
  };
}

function withInstagram(id: string, overrides: Partial<ManagedPage> = {}): ManagedPage {
  return page(id, { instagram: { id: `ig-${id}`, username: `venue${id}`, name: null }, ...overrides });
}

let db: InMemoryConnectionsDb;

function useInMemoryDb() {
  db = new InMemoryConnectionsDb();
  db.seed('accounts', [{ id: ACCOUNT }, { id: OTHER_ACCOUNT }]);
  mockFrom.mockImplementation((table: string) => db.client().from(table));
}

/** A state as initiateOAuthConnect stores it: started by USER_ID unless overridden. */
function seedState(overrides: Record<string, unknown> = {}) {
  db.seed('oauth_states', [
    {
      state: 'valid-state',
      provider: 'facebook',
      account_id: ACCOUNT,
      created_by: USER_ID,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      ...overrides,
    },
  ]);
}

/** requireAuthContext() for a visitor who is not signed in: it redirects by throwing. */
function signedOut() {
  mockRequireAuthContext.mockImplementation(async () => redirect('/auth/login'));
}

function warnings(): string {
  return vi.mocked(console.warn).mock.calls.flat().map(String).join('\n');
}

/** A connection that currently holds a token (a token_vault access row). */
function seedConnection(provider: 'facebook' | 'instagram', metadata: Record<string, unknown>, withToken = true) {
  const id = `${provider}-conn`;
  db.seed('social_connections', [{ id, account_id: ACCOUNT, provider, status: 'active', metadata }]);
  if (withToken) {
    db.seed('token_vault', [{ social_connection_id: id, token_type: 'access', ciphertext: 'c', iv: 'i', tag: 't' }]);
  }
}

function connectionRow(provider: 'facebook' | 'instagram') {
  return db.rows('social_connections').find((row) => row.provider === provider);
}

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are established
// ---------------------------------------------------------------------------

const {
  initiateOAuthConnect,
  completeOAuthConnect,
  disconnectProvider,
} = await import('./actions');
const { readPageChoice, PAGE_CHOICE_PATH } = await import('@/lib/connections/page-choice');

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
    // Only the signed-in user who started it can finish it.
    expect(insertCall).toHaveProperty('created_by', USER_ID);
    // A normal connect never forces the chooser.
    expect(insertCall).not.toHaveProperty('redirect_to');
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

  it('records Change Page on the state row so the callback shows the chooser', async () => {
    useInMemoryDb();

    const result = await initiateOAuthConnect('facebook', { changePage: true });

    expect(result.success).toBe(true);
    expect(db.rows('oauth_states')).toEqual([
      expect.objectContaining({
        provider: 'facebook',
        account_id: ACCOUNT,
        created_by: USER_ID,
        redirect_to: PAGE_CHOICE_PATH,
        auth_code: null,
      }),
    ]);
  });

  it.each([
    ['Facebook', 'facebook', undefined],
    ['Instagram', 'instagram', undefined],
    ['Change Page', 'facebook', { changePage: true }],
  ])('%s: records the signed-in user as the only one who can finish it', async (_flow, provider, options) => {
    useInMemoryDb();

    const result = await initiateOAuthConnect(provider, options);

    expect(result.success).toBe(true);
    expect(db.rows('oauth_states')).toEqual([expect.objectContaining({ provider, account_id: ACCOUNT, created_by: USER_ID })]);
    // A real uuid, as the live created_by column requires.
    expect(db.rejected).toEqual([]);
  });

  it('sends a signed-out visitor to sign in without storing a state', async () => {
    useInMemoryDb();
    signedOut();

    await expect(initiateOAuthConnect('facebook')).rejects.toThrow('NEXT_REDIRECT');
    expect(db.rows('oauth_states')).toHaveLength(0);
    expect(mockBuildOAuthRedirectUrl).not.toHaveBeenCalled();
  });

  it('fails closed, and logs it, when the state cannot be stored', async () => {
    useInMemoryDb();
    db.fail('oauth_states', 'insert', 1);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await initiateOAuthConnect('instagram');

    expect(result).toEqual({ success: false, error: 'Failed to initiate OAuth flow' });
    expect(db.rows('oauth_states')).toHaveLength(0);
    expect(mockBuildOAuthRedirectUrl).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[connections] failed to insert oauth_states', expect.anything());
    consoleError.mockRestore();
  });

  it('refuses Change Page on Instagram while Facebook is connected (Facebook is the anchor)', async () => {
    useInMemoryDb();
    seedConnection('facebook', { pageId: '1' });

    const result = await initiateOAuthConnect('instagram', { changePage: true });

    expect(result).toEqual({
      success: false,
      error: 'Instagram uses the Page connected to Facebook. To change it, use Change Page on the Facebook card.',
    });
    expect(db.rows('oauth_states')).toHaveLength(0);
  });

  it('allows Change Page on Instagram when Facebook is not connected', async () => {
    useInMemoryDb();
    seedConnection('facebook', { pageId: '1' }, false);

    const result = await initiateOAuthConnect('instagram', { changePage: true });

    expect(result.success).toBe(true);
    expect(db.rows('oauth_states')[0]).toMatchObject({ provider: 'instagram', redirect_to: PAGE_CHOICE_PATH, created_by: USER_ID });
  });
});

describe('completeOAuthConnect', () => {
  const auth = {
    userAccessToken: USER_TOKEN,
    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    metaUserId: 'meta-user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TOKEN_VAULT_KEY', randomBytes(32).toString('hex'));
    mockRequireAuthContext.mockResolvedValue(authContext());
    mockExchangeCodeForUserToken.mockResolvedValue(auth);
    mockStoreEncryptedToken.mockResolvedValue(undefined);
    useInMemoryDb();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('connects the only Page straight away, as before, and stores its token in the vault', async () => {
    seedState();
    mockFetchManagedPages.mockResolvedValue([page('1')]);

    const result = await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    expect(result).toEqual({ success: true });
    expect(mockExchangeCodeForUserToken).toHaveBeenCalledWith('facebook', 'auth-code-123');
    expect(mockFetchManagedPages).toHaveBeenCalledWith(USER_TOKEN);
    const row = connectionRow('facebook');
    expect(row).toMatchObject({
      account_id: ACCOUNT,
      status: 'active',
      platform_account_id: '1',
      platform_account_name: 'Page 1',
      display_name: 'Page 1',
      metadata: { pageId: '1' },
      token_expires_at: auth.expiresAt,
      meta_user_id: 'meta-user-1',
      // Never a plaintext token column.
      access_token: null,
      refresh_token: null,
    });
    expect(row?.scopes).toEqual([
      'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
      'instagram_basic', 'instagram_content_publish', 'business_management',
    ]);
    expect(mockStoreEncryptedToken).toHaveBeenCalledTimes(1);
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith(row?.id, 'access', 'page-token-1');
    expect(db.rows('oauth_states')[0].used_at).not.toBeNull();
    expect(db.rejected).toEqual([]);
  });

  it('reconnects the stored Page with no chooser when several Pages come back (every reconnect today)', async () => {
    seedState();
    seedConnection('facebook', { pageId: '2' });
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2'), page('3')]);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({ success: true });
    expect(connectionRow('facebook')).toMatchObject({ metadata: { pageId: '2' }, status: 'active' });
    expect(db.rows('oauth_states')).toHaveLength(1);
  });

  it('reconnects Instagram on the same Page as Facebook, as for The Anchor', async () => {
    seedState({ provider: 'instagram' });
    seedConnection('facebook', { pageId: '2', igBusinessId: 'ig-2' });
    seedConnection('instagram', { pageId: '2', igBusinessId: 'ig-2', instagramUsername: 'venue2' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), withInstagram('2')]);

    const result = await completeOAuthConnect('instagram', 'code', 'valid-state');

    expect(result).toEqual({ success: true });
    expect(connectionRow('instagram')).toMatchObject({
      platform_account_id: 'ig-2',
      metadata: { pageId: '2', igBusinessId: 'ig-2', instagramUsername: 'venue2' },
    });
    expect(mockStoreEncryptedToken).toHaveBeenCalledWith('instagram-conn', 'access', 'page-token-2');
  });

  it('asks the owner when several Pages come back and none is stored, connecting nothing yet', async () => {
    seedState();
    mockFetchManagedPages.mockResolvedValue([page('1'), withInstagram('2')]);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result.success).toBe(true);
    expect(result.pageChoice).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.rows('social_connections')).toHaveLength(0);
    expect(mockStoreEncryptedToken).not.toHaveBeenCalled();

    const handOff = db.rows('oauth_states').find((row) => row.state === result.pageChoice);
    // The hand-off is bound to the same person as the login.
    expect(handOff).toMatchObject({ provider: 'facebook', account_id: ACCOUNT, redirect_to: PAGE_CHOICE_PATH, created_by: USER_ID });
    expect(String(handOff?.auth_code)).not.toContain(USER_TOKEN);
    expect(String(handOff?.auth_code)).not.toContain('page-token');

    const otherOwner = await readPageChoice(db.client(), { token: result.pageChoice!, userId: OTHER_USER_ID, ownedAccountIds: [ACCOUNT] });
    expect(otherOwner).toMatchObject({ ok: false, reason: 'forbidden' });

    const read = await readPageChoice(db.client(), { token: result.pageChoice!, userId: USER_ID, ownedAccountIds: [ACCOUNT] });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.choice.payload).toMatchObject({ changePage: false, userAccessToken: USER_TOKEN, metaUserId: 'meta-user-1' });
    expect(read.choice.payload.pages).toEqual([
      { id: '1', name: 'Page 1', instagramUsername: null, hasInstagram: false, canPostToFacebook: true, canPostToInstagram: false },
      { id: '2', name: 'Page 2', instagramUsername: 'venue2', hasInstagram: true, canPostToFacebook: true, canPostToInstagram: true },
    ]);
  });

  it('always asks for Change Page, even when the stored Page matches', async () => {
    seedState({ redirect_to: PAGE_CHOICE_PATH });
    seedConnection('facebook', { pageId: '1' });
    seedConnection('instagram', { pageId: '1', igBusinessId: 'ig-1' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1')]);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result.pageChoice).toBeDefined();
    const read = await readPageChoice(db.client(), { token: result.pageChoice!, userId: USER_ID, ownedAccountIds: [ACCOUNT] });
    if (!read.ok) throw new Error('expected a readable choice');
    expect(read.choice.payload).toMatchObject({ changePage: true, currentPageId: '1', instagramPageId: '1' });
  });

  it("uses Facebook's Page for Instagram when Facebook is connected", async () => {
    seedState({ provider: 'instagram' });
    seedConnection('facebook', { pageId: '2' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), withInstagram('2')]);

    const result = await completeOAuthConnect('instagram', 'code', 'valid-state');

    expect(result).toEqual({ success: true });
    expect(connectionRow('instagram')).toMatchObject({ metadata: expect.objectContaining({ pageId: '2', igBusinessId: 'ig-2' }) });
  });

  it("refuses Instagram, connecting nothing, when Facebook's Page has no Instagram account", async () => {
    seedState({ provider: 'instagram' });
    seedConnection('facebook', { pageId: '1' });
    mockFetchManagedPages.mockResolvedValue([page('1'), withInstagram('2')]);

    const result = await completeOAuthConnect('instagram', 'code', 'valid-state');

    expect(result.success).toBe(false);
    expect(result.error).toContain('same Page as Facebook');
    expect(connectionRow('instagram')).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('linked_page_without_instagram'));
  });

  it('a disconnected Facebook no longer binds Instagram to its old Page', async () => {
    seedState({ provider: 'instagram' });
    seedConnection('facebook', { pageId: '1' }, false);
    mockFetchManagedPages.mockResolvedValue([page('1'), withInstagram('2')]);

    const result = await completeOAuthConnect('instagram', 'code', 'valid-state');

    expect(result.success).toBe(true);
    expect(result.pageChoice).toBeDefined();
  });

  it('should return error for already-used state (replay prevention)', async () => {
    seedState({ used_at: new Date().toISOString() });

    const result = await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    expect(result).toEqual({ success: false, error: 'Invalid or expired OAuth state' });
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
  });

  it('should return error for expired state', async () => {
    seedState({ expires_at: new Date(Date.now() - 1000).toISOString() });

    const result = await completeOAuthConnect('facebook', 'auth-code-123', 'valid-state');

    expect(result.error).toContain('Invalid');
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
  });

  it('should return error for non-existent state (state fixation prevention)', async () => {
    const result = await completeOAuthConnect('instagram', 'auth-code-123', 'fake-state');

    expect(result.error).toContain('Invalid');
    expect(mockStoreEncryptedToken).not.toHaveBeenCalled();
  });

  it('never accepts a pending Page choice as an OAuth state', async () => {
    seedState();
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);
    const first = await completeOAuthConnect('facebook', 'code', 'valid-state');
    mockExchangeCodeForUserToken.mockClear();

    const replay = await completeOAuthConnect('facebook', 'code', first.pageChoice!);

    expect(replay).toEqual({ success: false, error: 'Invalid or expired OAuth state' });
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
  });

  it.each([
    ['a Facebook login', 'facebook', {}],
    ['an Instagram login', 'instagram', { provider: 'instagram' }],
    ['a Change Page login', 'facebook', { redirect_to: PAGE_CHOICE_PATH }],
  ])('refuses %s started by another signed-in user, even an owner of the brand, and does not use it up', async (_flow, provider, overrides) => {
    seedState(overrides);
    // An owner of the same brand: only created_by tells them apart.
    mockRequireAuthContext.mockResolvedValue(authContext({ user: { id: OTHER_USER_ID } }));
    mockFetchManagedPages.mockResolvedValue([withInstagram('1')]);

    const result = await completeOAuthConnect(provider, 'code', 'valid-state');

    expect(result).toEqual({ success: false, error: 'Invalid or expired OAuth state' });
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
    expect(db.rows('social_connections')).toHaveLength(0);
    // No Page choice was made, and the state is still there for the person who started it.
    expect(db.rows('oauth_states')).toHaveLength(1);
    expect(db.rows('oauth_states')[0].used_at).toBeNull();
    expect(warnings()).toContain('OAuth state refused: started by someone else');
    expect(warnings()).toContain(`"userId":"${OTHER_USER_ID}"`);
    expect(warnings()).toContain(`"startedBy":"${USER_ID}"`);
    // Ids only: never the state itself.
    expect(warnings()).not.toContain('valid-state');

    mockRequireAuthContext.mockResolvedValue(authContext());
    expect((await completeOAuthConnect(provider, 'code', 'valid-state')).success).toBe(true);
  });

  it('refuses a state with no created_by (made before it was recorded), using nothing up', async () => {
    seedState({ created_by: null });
    mockFetchManagedPages.mockResolvedValue([page('1')]);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({ success: false, error: 'Invalid or expired OAuth state' });
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
    expect(db.rows('social_connections')).toHaveLength(0);
    expect(db.rows('oauth_states')[0].used_at).toBeNull();
    expect(warnings()).toContain('"startedBy":null');
  });

  it('sends a signed-out visitor to sign in, touching nothing', async () => {
    seedState();
    signedOut();

    await expect(completeOAuthConnect('facebook', 'code', 'valid-state')).rejects.toThrow('NEXT_REDIRECT');
    expect(db.queries).toHaveLength(0);
    expect(db.rows('oauth_states')[0].used_at).toBeNull();
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
  });

  it('fails closed, using nothing up, when the state cannot be looked up', async () => {
    seedState();
    db.fail('oauth_states', 'select', 1);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({ success: false, error: 'OAuth state validation failed' });
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
    expect(db.rows('oauth_states')[0].used_at).toBeNull();
    expect(console.error).toHaveBeenCalledWith('[connections] oauth_states lookup failed', expect.anything());
  });

  it('fails closed, connecting nothing, when the state cannot be marked used', async () => {
    seedState();
    db.fail('oauth_states', 'update', 1);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({ success: false, error: 'Failed to process OAuth state' });
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
    expect(db.rows('social_connections')).toHaveLength(0);
  });

  it('refuses a user who is only a member of the brand that started the flow', async () => {
    mockRequireAuthContext.mockResolvedValue(
      authContext({ accountId: OTHER_ACCOUNT, brands: [{ accountId: OTHER_ACCOUNT, role: 'owner' }, { accountId: ACCOUNT, role: 'member' }] }),
    );
    seedState();

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({
      success: false,
      error: 'You no longer have owner access to the brand that started this connection.',
    });
    expect(mockExchangeCodeForUserToken).not.toHaveBeenCalled();
  });

  it('should return an actionable error when token vault config is missing, leaving the connection needs_action', async () => {
    mockStoreEncryptedToken.mockRejectedValue(
      new Error('Missing encryption key: TOKEN_VAULT_KEY environment variable is not set'),
    );
    seedState({ provider: 'instagram' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1')]);

    const result = await completeOAuthConnect('instagram', 'auth-code-123', 'valid-state');

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOKEN_VAULT_KEY');
    expect(result.error).toContain('Supabase Edge Function secrets');
    expect(connectionRow('instagram')?.status).toBe('needs_action');
  });

  it('returns Meta errors from the login to the owner', async () => {
    seedState();
    mockExchangeCodeForUserToken.mockRejectedValue(new Error('OAuthException: Code expired (code 100)'));

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({ success: false, error: 'OAuthException: Code expired (code 100)' });
  });

  it('refuses a Page that came back without a token, as before', async () => {
    seedState();
    mockFetchManagedPages.mockResolvedValue([page('1', { accessToken: null })]);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing an access token');
    expect(connectionRow('facebook')).toBeUndefined();
  });

  it('fails closed, and says so in the logs, when the connections cannot be read', async () => {
    seedState();
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);
    db.fail('social_connections', 'select', 1);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({ success: false, error: "We could not check this brand's connections. Please try again." });
    expect(db.rows('oauth_states')).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not load connections'));
  });

  it('fails closed when the Page list cannot be saved for the chooser', async () => {
    seedState();
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);
    db.fail('oauth_states', 'insert', 1);

    const result = await completeOAuthConnect('facebook', 'code', 'valid-state');

    expect(result).toEqual({ success: false, error: 'We could not save your list of Pages. Please try again.' });
    expect(db.rows('social_connections')).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not store the Page choice'));
  });

  it('never logs the Meta user token', async () => {
    seedState();
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);
    db.fail('oauth_states', 'insert', 1);

    await completeOAuthConnect('facebook', 'code', 'valid-state');

    const logged = [
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.log).mock.calls,
    ].flat().map(String).join('\n');
    expect(logged).not.toContain(USER_TOKEN);
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
    mockRequireAuthContext.mockResolvedValue(authContext({ accountId: 'acc-1' }));
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
    await expect(initiateOAuthConnect('facebook', { changePage: true })).rejects.toThrow('Only an owner of this brand can do that.');
    await expect(completeOAuthConnect('facebook', 'code', 'state')).rejects.toThrow('Only an owner of this brand can do that.');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
