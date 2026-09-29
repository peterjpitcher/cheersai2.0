import { randomBytes } from 'node:crypto';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryConnectionsDb } from '../../../../../tests/helpers/in-memory-connections-db';

let db: InMemoryConnectionsDb;
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => db.client()),
}));

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

const { default: ChoosePage, metadata } = await import('./page');
const { createPageChoice } = await import('@/lib/connections/page-choice');

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = 'user-owner';
const USER_TOKEN = 'EAAB-user-token-never-shown';

function authContext(userId = USER) {
  return {
    accountId: ACCOUNT,
    activeAccountId: ACCOUNT,
    user: { id: userId },
    brands: [{ accountId: ACCOUNT, name: 'The Crown', timezone: 'Europe/London', role: 'owner' }],
    isSuperAdmin: false,
    role: 'owner',
  };
}

async function choice(provider: 'facebook' | 'instagram' = 'facebook') {
  return createPageChoice(db.client(), {
    userId: USER,
    accountId: ACCOUNT,
    provider,
    changePage: false,
    userAccessToken: USER_TOKEN,
    expiresAt: null,
    metaUserId: null,
    currentPageId: null,
    instagramPageId: null,
    pages: [
      { id: '101', name: 'The Crown', instagramUsername: 'thecrown', hasInstagram: true, canPostToFacebook: true, canPostToInstagram: true },
      { id: '202', name: 'Crown Events', instagramUsername: null, hasInstagram: false, canPostToFacebook: true, canPostToInstagram: false },
    ],
  });
}

async function renderPage(token: string | undefined) {
  return renderToStaticMarkup(await ChoosePage({ searchParams: Promise.resolve(token ? { choice: token } : {}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TOKEN_VAULT_KEY', randomBytes(32).toString('hex'));
  db = new InMemoryConnectionsDb();
  db.seed('accounts', [{ id: ACCOUNT }]);
  mockRequireAuthContext.mockResolvedValue(authContext());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('/connections/choose-page', () => {
  it('keeps the choice reference off other sites', () => {
    expect(metadata.referrer).toBe('same-origin');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("lists the owner's Pages by name, without any token", async () => {
    const html = await renderPage(await choice());

    expect(html).toContain('Choose your Facebook Page');
    expect(html).toContain('You manage more than one Facebook Page. Choose the one CheersAI should post to for The Crown.');
    expect(html).toContain('Crown Events');
    expect(html).toContain('Instagram: @thecrown');
    expect(html).not.toContain(USER_TOKEN);
  });

  it('explains the Instagram list', async () => {
    const html = await renderPage(await choice('instagram'));

    expect(html).toContain('Choose your Instagram account');
    expect(html).toContain('No Instagram professional account is linked to this Page.');
  });

  it('shows a clear message and a way back for an unknown or missing choice, and logs it', async () => {
    const html = await renderPage('B'.repeat(43));

    expect(html).toContain('We could not find this Page choice. Start again from the Connections screen.');
    expect(html).toContain('href="/connections"');
    expect(html).not.toContain('Start again</button>');
    expect(vi.mocked(console.warn).mock.calls.flat().join('\n')).toContain('not_found');

    expect(await renderPage(undefined)).toContain('We could not find this Page choice.');
  });

  it("does not show another person's choice", async () => {
    const token = await choice();
    mockRequireAuthContext.mockResolvedValue(authContext('someone-else'));

    const html = await renderPage(token);

    expect(html).toContain('We could not find this Page choice.');
    expect(html).not.toContain('Crown Events');
  });

  it('offers Start again once a choice has expired', async () => {
    const token = await choice();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    const html = await renderPage(token);

    expect(html).toContain('This Page choice has expired. Start again to see your Pages.');
    expect(html).toContain('Start again');
  });
});
