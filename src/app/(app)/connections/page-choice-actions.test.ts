import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ManagedPage } from '@/lib/connections/page-selection';
import { InMemoryConnectionsDb } from '../../../../tests/helpers/in-memory-connections-db';

// ---------------------------------------------------------------------------
// Mocks: Supabase is the in-memory database (the real token vault writes into
// it, encrypted with a throwaway key); Meta's Page list is stubbed.
// ---------------------------------------------------------------------------

let db: InMemoryConnectionsDb;
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => db.client()),
}));

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
}));

const mockFetchManagedPages = vi.fn();
vi.mock('@/lib/connections/token-exchange', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/connections/token-exchange')>()),
  fetchManagedPages: (...args: unknown[]) => mockFetchManagedPages(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { choosePageForConnection } = await import('./page-choice-actions');
const { createPageChoice, toPageChoiceOption } = await import('@/lib/connections/page-choice');
const { decrypt } = await import('@/lib/token-vault');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const USER = 'user-owner';
const USER_TOKEN = 'EAAB-user-token-never-shown';

type Role = 'owner' | 'member';

function authContext(userId = USER, brands: Array<{ accountId: string; role: Role }> = [{ accountId: ACCOUNT, role: 'owner' }]) {
  return {
    accountId: brands[0].accountId,
    activeAccountId: brands[0].accountId,
    user: { id: userId },
    brands: brands.map((brand) => ({ ...brand, name: 'The Crown', timezone: 'Europe/London' })),
    isSuperAdmin: false,
    role: brands[0].role,
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

const expiresAt = () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

async function pendingChoice(
  pages: ManagedPage[],
  overrides: Partial<{ provider: 'facebook' | 'instagram'; changePage: boolean; instagramPageId: string | null }> = {},
): Promise<string> {
  return createPageChoice(db.client(), {
    userId: USER,
    accountId: ACCOUNT,
    provider: overrides.provider ?? 'facebook',
    changePage: overrides.changePage ?? false,
    userAccessToken: USER_TOKEN,
    expiresAt: expiresAt(),
    metaUserId: 'meta-user-1',
    currentPageId: null,
    instagramPageId: overrides.instagramPageId ?? null,
    pages: pages.map(toPageChoiceOption),
  });
}

function seedConnection(provider: 'facebook' | 'instagram', metadata: Record<string, unknown>) {
  const id = `${provider}-conn`;
  db.seed('social_connections', [{ id, account_id: ACCOUNT, provider, status: 'active', metadata }]);
  db.seed('token_vault', [{ social_connection_id: id, token_type: 'access', ciphertext: 'c', iv: 'i', tag: 't' }]);
}

const connectionRow = (provider: 'facebook' | 'instagram') =>
  db.rows('social_connections').find((row) => row.provider === provider);

function storedToken(connectionId: unknown): string | null {
  const row = db.rows('token_vault').find((r) => r.social_connection_id === connectionId && r.token_type === 'access');
  if (!row) return null;
  expect(String(row.ciphertext)).not.toContain('page-token');
  return decrypt({ ciphertext: String(row.ciphertext), iv: String(row.iv), tag: String(row.tag), keyVersion: Number(row.key_version) });
}

const handOff = () => db.rows('oauth_states')[0];

function loggedText(): string {
  return [
    ...vi.mocked(console.error).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.log).mock.calls,
  ]
    .flat()
    .map(String)
    .join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TOKEN_VAULT_KEY', randomBytes(32).toString('hex'));
  db = new InMemoryConnectionsDb();
  db.seed('accounts', [{ id: ACCOUNT }, { id: OTHER_ACCOUNT }]);
  mockRequireAuthContext.mockResolvedValue(authContext());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe('choosePageForConnection: connecting the chosen Page', () => {
  it('connects the chosen Page with a fresh token, encrypted in the vault, and uses up the choice', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({ success: true, provider: 'facebook', notice: undefined });
    expect(mockFetchManagedPages).toHaveBeenCalledWith(USER_TOKEN);
    const row = connectionRow('facebook');
    expect(row).toMatchObject({ status: 'active', platform_account_id: '2', metadata: { pageId: '2' }, meta_user_id: 'meta-user-1' });
    expect(storedToken(row?.id)).toBe('page-token-2');
    expect(handOff()).toMatchObject({ auth_code: null });
    expect(handOff().used_at).not.toBeNull();
    expect(db.rejected).toEqual([]);
  });

  it('connects Instagram through the chosen Page', async () => {
    const token = await pendingChoice([withInstagram('1'), withInstagram('2')], { provider: 'instagram' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), withInstagram('2')]);

    const result = await choosePageForConnection({ choice: token, pageId: '1' });

    expect(result.success).toBe(true);
    const row = connectionRow('instagram');
    expect(row).toMatchObject({ platform_account_id: 'ig-1', metadata: { pageId: '1', igBusinessId: 'ig-1', instagramUsername: 'venue1' } });
    expect(storedToken(row?.id)).toBe('page-token-1');
  });
});

describe('choosePageForConnection: Facebook and Instagram stay on one Page', () => {
  it("moves a connected Instagram to the new Page's account", async () => {
    seedConnection('facebook', { pageId: '1' });
    seedConnection('instagram', { pageId: '1', igBusinessId: 'ig-1' });
    const token = await pendingChoice([withInstagram('1'), withInstagram('2')], { changePage: true, instagramPageId: '1' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), withInstagram('2')]);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({ success: true, provider: 'facebook', notice: 'Instagram now uses @venue2, on the same Page.' });
    expect(connectionRow('facebook')).toMatchObject({ metadata: { pageId: '2', igBusinessId: 'ig-2' } });
    const instagram = connectionRow('instagram');
    expect(instagram).toMatchObject({ status: 'active', platform_account_id: 'ig-2', metadata: { pageId: '2', igBusinessId: 'ig-2', instagramUsername: 'venue2' } });
    // The token came from the Facebook login, so its scopes are recorded as the Facebook list.
    expect(instagram?.scopes).toContain('pages_manage_posts');
    expect(storedToken('instagram-conn')).toBe('page-token-2');
  });

  it('disconnects a connected Instagram when the new Page has no account CheersAI can post to', async () => {
    seedConnection('facebook', { pageId: '1' });
    seedConnection('instagram', { pageId: '1', igBusinessId: 'ig-1' });
    const token = await pendingChoice([withInstagram('1'), page('2')], { changePage: true, instagramPageId: '1' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), page('2')]);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({
      success: true,
      provider: 'facebook',
      notice: 'Instagram was disconnected, as Page 2 has no Instagram account CheersAI can post to.',
    });
    expect(connectionRow('instagram')).toMatchObject({ status: 'needs_action', metadata: { pageId: '1', igBusinessId: 'ig-1' } });
    expect(db.rows('token_vault').some((row) => row.social_connection_id === 'instagram-conn')).toBe(false);
  });

  it('leaves Instagram alone when it is already on the chosen Page, or not connected', async () => {
    seedConnection('instagram', { pageId: '2', igBusinessId: 'ig-2' });
    const token = await pendingChoice([page('1'), withInstagram('2')], { instagramPageId: '2' });
    mockFetchManagedPages.mockResolvedValue([page('1'), withInstagram('2')]);
    const before = connectionRow('instagram');

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result.notice).toBeUndefined();
    expect(connectionRow('instagram')).toEqual(before);
  });

  it('leaves a legacy Instagram row without a Page id alone, as the chooser showed no warning for it', async () => {
    seedConnection('instagram', { igBusinessId: 'ig-1' });
    const token = await pendingChoice([withInstagram('1'), withInstagram('2')]);
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), withInstagram('2')]);
    const before = connectionRow('instagram');

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({ success: true, provider: 'facebook', notice: undefined });
    expect(connectionRow('instagram')).toEqual(before);
  });

  it('reports, and logs, an Instagram move that could not be saved', async () => {
    seedConnection('instagram', { pageId: '1', igBusinessId: 'ig-1' });
    const token = await pendingChoice([withInstagram('1'), withInstagram('2')], { instagramPageId: '1' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), withInstagram('2')]);
    // The Facebook save is the first upsert; the Instagram move, the second, fails.
    db.fail('social_connections', 'upsert', 1, { skip: 1 });

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({
      success: false,
      provider: 'facebook',
      error: 'Facebook now uses Page 2, but Instagram could not be moved to it. Connect Instagram again.',
    });
    expect(loggedText()).toContain('could not move Instagram');
  });

  it('refuses an Instagram choice when Facebook moved to another Page meanwhile', async () => {
    const token = await pendingChoice([withInstagram('1'), withInstagram('2')], { provider: 'instagram' });
    seedConnection('facebook', { pageId: '2' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), withInstagram('2')]);

    const result = await choosePageForConnection({ choice: token, pageId: '1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Facebook was connected to a different Page');
    expect(connectionRow('instagram')).toBeUndefined();
  });
});

describe('choosePageForConnection: fails closed', () => {
  it('refuses a Page that was not in the list, without using up the choice', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2'), page('9')]);

    const refused = await choosePageForConnection({ choice: token, pageId: '9' });
    expect(refused).toEqual({ success: false, provider: 'facebook', error: 'That Page was not in your list. Start again to see your Pages.' });
    expect(handOff().used_at).toBeNull();
    expect(loggedText()).toContain('page_not_shown');

    expect((await choosePageForConnection({ choice: token, pageId: '1' })).success).toBe(true);
  });

  it('refuses a choice that was already used', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);

    await choosePageForConnection({ choice: token, pageId: '1' });
    const second = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(second).toEqual({
      success: false,
      provider: 'facebook',
      error: 'This Page choice has already been used. If your Page is not connected yet, start again from the Connections screen.',
    });
    expect(mockFetchManagedPages).toHaveBeenCalledTimes(1);
    expect(connectionRow('facebook')).toMatchObject({ metadata: { pageId: '1' } });
  });

  it('lets only one of two simultaneous submits through', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);

    const results = await Promise.all([
      choosePageForConnection({ choice: token, pageId: '1' }),
      choosePageForConnection({ choice: token, pageId: '2' }),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(db.rows('social_connections')).toHaveLength(1);
  });

  it('refuses an expired choice and offers Start again for the same platform', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    const result = await choosePageForConnection({ choice: token, pageId: '1' });

    expect(result).toEqual({ success: false, provider: 'facebook', error: 'This Page choice has expired. Start again to see your Pages.' });
    expect(mockFetchManagedPages).not.toHaveBeenCalled();
  });

  it("refuses another owner's choice, even in the same brand", async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockRequireAuthContext.mockResolvedValue(authContext('another-owner'));

    const result = await choosePageForConnection({ choice: token, pageId: '1' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('We could not find this Page choice. Start again from the Connections screen.');
    expect(handOff().used_at).toBeNull();
    expect(loggedText()).toContain('forbidden');
  });

  it('refuses when the user is no longer an owner of the brand the choice is for', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockRequireAuthContext.mockResolvedValue(
      authContext(USER, [
        { accountId: OTHER_ACCOUNT, role: 'owner' },
        { accountId: ACCOUNT, role: 'member' },
      ]),
    );

    const result = await choosePageForConnection({ choice: token, pageId: '1' });

    expect(result.error).toBe('We could not find this Page choice. Start again from the Connections screen.');
    expect(db.rows('social_connections')).toHaveLength(0);
  });

  it('refuses malformed input without touching the database', async () => {
    expect((await choosePageForConnection({ choice: 'short', pageId: '1' })).success).toBe(false);
    expect((await choosePageForConnection({ choice: 'a'.repeat(43), pageId: '1; drop' })).success).toBe(false);
    expect(db.queries).toHaveLength(0);
  });

  it('fails closed, connecting nothing, when the choice cannot be claimed', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);
    db.fail('oauth_states', 'update', 1);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({ success: false, provider: 'facebook', error: 'We could not finish this. Please start again.' });
    expect(mockFetchManagedPages).not.toHaveBeenCalled();
    expect(db.rows('social_connections')).toHaveLength(0);
    expect(loggedText()).toContain('could not claim the Page choice');
  });

  it('fails closed, logs it and uses up the choice, when Meta cannot be asked again', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockRejectedValue(new Error('fetch failed'));

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({ success: false, provider: 'facebook', error: 'We could not check your Pages with Facebook. Please start again.' });
    expect(db.rows('social_connections')).toHaveLength(0);
    expect(handOff().used_at).not.toBeNull();
    expect(loggedText()).toContain('could not re-read the Pages');
  });

  it('refuses a Page the owner no longer manages', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1')]);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result.error).toBe(
      'Your Facebook profile no longer manages Page 2, or has not given CheersAI access to it. Start again to choose a Page.',
    );
    expect(db.rows('social_connections')).toHaveLength(0);
    expect(loggedText()).toContain('page_no_longer_managed');
  });

  it('refuses a Page the owner can no longer post to', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2', { tasks: ['ANALYZE', 'ADVERTISE'] })]);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result.error).toContain('Your Facebook profile cannot post to Page 2');
    expect(db.rows('social_connections')).toHaveLength(0);
  });

  it('refuses an Instagram choice whose Page lost its Instagram account', async () => {
    const token = await pendingChoice([withInstagram('1'), withInstagram('2')], { provider: 'instagram' });
    mockFetchManagedPages.mockResolvedValue([withInstagram('1'), page('2')]);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result.error).toBe('Page 2 no longer has a linked Instagram professional account. Start again to choose a Page.');
  });

  it('leaves the connection needs_action, and says so, when the vault write fails', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);
    db.fail('token_vault', 'upsert', 1);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result).toEqual({ success: false, provider: 'facebook', error: 'Failed to store connection tokens' });
    expect(connectionRow('facebook')?.status).toBe('needs_action');
    expect(loggedText()).toContain('could not save the chosen Page');
  });

  it('fails closed when the brand connections cannot be read', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1'), page('2')]);
    db.fail('social_connections', 'select', 1);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result.success).toBe(false);
    expect(result.error).toContain("We could not check this brand's connections");
    expect(db.rows('social_connections')).toHaveLength(0);
  });

  it('reports a failed lookup as a problem to retry, and logs it as an error', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    db.fail('oauth_states', 'select', 1);

    const result = await choosePageForConnection({ choice: token, pageId: '2' });

    expect(result.error).toBe('We could not load this Page choice. Please try again in a minute.');
    expect(vi.mocked(console.error).mock.calls.flat().map(String).join('\n')).toContain('could not read the Page choice');
  });

  it('never logs the Meta user token or a Page token', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    mockFetchManagedPages.mockResolvedValue([page('1')]);
    await choosePageForConnection({ choice: token, pageId: '2' });

    expect(loggedText()).not.toContain(USER_TOKEN);
    expect(loggedText()).not.toContain('page-token');
  });

  it('refuses members before touching the database', async () => {
    const token = await pendingChoice([page('1'), page('2')]);
    const queriesBefore = db.queries.length;
    mockRequireAuthContext.mockResolvedValue(authContext(USER, [{ accountId: ACCOUNT, role: 'member' }]));

    await expect(choosePageForConnection({ choice: token, pageId: '1' })).rejects.toThrow('Only an owner of this brand can do that.');
    expect(db.queries.length).toBe(queriesBefore);
  });
});
