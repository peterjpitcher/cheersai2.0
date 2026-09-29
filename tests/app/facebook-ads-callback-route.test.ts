import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthDependencyError } from '@/lib/auth/errors';
import { InMemoryConnectionsDb } from '../helpers/in-memory-connections-db';

const mocks = vi.hoisted(() => ({
  storeMetaAdAccountToken: vi.fn(),
  adAccountUpsert: vi.fn(),
  getCurrentUser: vi.fn(),
}));

// oauth_states is the in-memory table with production's constraints; the rest stays mocked.
let db: InMemoryConnectionsDb;
const ACCOUNT = 'account-1';
const CHOICE_REFERENCE = 'C'.repeat(43);
// Supabase auth user ids are uuids, and oauth_states.created_by is a uuid column.
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// The signed-in user from the cookie session.
vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/env', () => ({
  env: {
    client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.test', NEXT_PUBLIC_FACEBOOK_APP_ID: 'fb-app' },
    server: { FACEBOOK_APP_SECRET: 'fb-secret' },
  },
}));

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: () => 'https://graph.facebook.com/v24.0',
}));

vi.mock('@/lib/meta/ad-account-tokens', () => ({
  storeMetaAdAccountToken: mocks.storeMetaAdAccountToken,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'oauth_states') {
        return db.client().from('oauth_states');
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { paid_ads_enabled: true }, error: null }),
            }),
          }),
        };
      }
      if (table === 'meta_ad_accounts') {
        return { upsert: mocks.adAccountUpsert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { GET } from '@/app/api/oauth/facebook-ads/callback/route';

function callbackRequest(state = 'state-1') {
  return new NextRequest(`https://cheers.test/api/oauth/facebook-ads/callback?code=abc&state=${state}`);
}

const stateRow = (state: string) => db.rows('oauth_states').find((row) => row.state === state);
const logged = (stream: 'warn' | 'error') => vi.mocked(console[stream]).mock.calls.flat().map(String).join('\n');

describe('GET /api/oauth/facebook-ads/callback', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    db = new InMemoryConnectionsDb();
    db.seed('accounts', [{ id: ACCOUNT }]);
    // As startAdsOAuth stores them: started by USER.
    db.seed('oauth_states', [
      { state: 'state-1', provider: 'facebook', account_id: ACCOUNT, created_by: USER },
      {
        state: 'expired-state',
        provider: 'facebook',
        account_id: ACCOUNT,
        created_by: USER,
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
      // A pending Page choice lives in the same table with an encrypted payload.
      {
        state: CHOICE_REFERENCE,
        provider: 'facebook',
        account_id: ACCOUNT,
        created_by: USER,
        redirect_to: '/connections/choose-page',
        auth_code: '{"ciphertext":"c","iv":"i","tag":"t","keyVersion":1}',
      },
    ]);
    mocks.getCurrentUser.mockResolvedValue({ id: USER });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'short-token', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-token', expires_in: 5184000 }), { status: 200 }));
    mocks.adAccountUpsert.mockResolvedValue({ error: null });
    mocks.storeMetaAdAccountToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores the long-lived token encrypted and never writes it to meta_ad_accounts', async () => {
    const response = await GET(callbackRequest());

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_step=select_account');
    const [payload, options] = mocks.adAccountUpsert.mock.calls[0];
    expect(payload).toEqual({
      account_id: 'account-1',
      token_expires_at: expect.any(String),
      setup_complete: false,
      meta_account_id: '',
    });
    expect(JSON.stringify(payload)).not.toContain('long-token');
    expect(options).toEqual({ onConflict: 'account_id' });
    expect(mocks.storeMetaAdAccountToken).toHaveBeenCalledWith(expect.anything(), 'account-1', 'access', 'long-token');
    // The row the token references must exist before the token is stored.
    expect(mocks.adAccountUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.storeMetaAdAccountToken.mock.invocationCallOrder[0],
    );
  });

  it('reports a database error to the user when the encrypted store fails', async () => {
    mocks.storeMetaAdAccountToken.mockRejectedValue(new Error('Failed to store Meta Ads token: boom'));

    const response = await GET(callbackRequest());

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=db_error');
  });

  it('does not store a token when the account row cannot be saved', async () => {
    mocks.adAccountUpsert.mockResolvedValue({ error: { message: 'db down' } });

    const response = await GET(callbackRequest());

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=db_error');
    expect(mocks.storeMetaAdAccountToken).not.toHaveBeenCalled();
  });

  it('marks the login state used', async () => {
    await GET(callbackRequest());

    expect(stateRow('state-1')?.used_at).not.toBeNull();
    expect(db.rejected).toEqual([]);
  });

  it('refuses a login another signed-in user started, using nothing up and asking Meta nothing', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: OTHER_USER });
    const before = stateRow('state-1');

    const response = await GET(callbackRequest());

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.adAccountUpsert).not.toHaveBeenCalled();
    expect(mocks.storeMetaAdAccountToken).not.toHaveBeenCalled();
    expect(stateRow('state-1')).toEqual(before);
    expect(logged('warn')).toContain('Meta Ads login refused: started by someone else');
    expect(logged('warn')).toContain(`"userId":"${OTHER_USER}"`);
    expect(logged('warn')).toContain(`"startedBy":"${USER}"`);
    // Ids only: never the state itself.
    expect(logged('warn')).not.toContain('state-1');

    // The person who started it can still finish it.
    mocks.getCurrentUser.mockResolvedValue({ id: USER });
    expect((await GET(callbackRequest())).headers.get('location')).toBe('https://cheers.test/connections?ads_step=select_account');
  });

  it('refuses when nobody is signed in, using nothing up', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const before = stateRow('state-1');

    const response = await GET(callbackRequest());

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateRow('state-1')).toEqual(before);
    expect(logged('warn')).toContain('Meta Ads login refused: not signed in');
  });

  it('refuses a login state without created_by (made before it was recorded)', async () => {
    db.seed('oauth_states', [{ state: 'old-state', provider: 'facebook', account_id: ACCOUNT }]);
    const before = stateRow('old-state');

    const response = await GET(callbackRequest('old-state'));

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateRow('old-state')).toEqual(before);
    expect(logged('warn')).toContain('"startedBy":null');
  });

  it('fails closed, using nothing up, when the sign-in check itself fails', async () => {
    mocks.getCurrentUser.mockRejectedValue(new AuthDependencyError('membership lookup failed'));
    const before = stateRow('state-1');

    const response = await GET(callbackRequest());

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateRow('state-1')).toEqual(before);
    expect(logged('error')).toContain('Meta Ads login refused: could not check who is signed in');
  });

  it('fails closed when the state cannot be looked up', async () => {
    db.fail('oauth_states', 'select', 1);

    const response = await GET(callbackRequest());

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(stateRow('state-1')?.used_at).toBeNull();
  });

  it('tells only the person who started it that the state was already used', async () => {
    db.tables.oauth_states.find((row) => row.state === 'state-1')!.used_at = new Date().toISOString();

    expect((await GET(callbackRequest())).headers.get('location')).toBe(
      'https://cheers.test/connections?ads_error=state_already_used',
    );
    mocks.getCurrentUser.mockResolvedValue({ id: OTHER_USER });
    expect((await GET(callbackRequest())).headers.get('location')).toBe(
      'https://cheers.test/connections?ads_error=invalid_state',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never accepts a pending Page choice as its login check, and leaves it untouched', async () => {
    const before = db.rows('oauth_states').find((row) => row.state === CHOICE_REFERENCE);

    const response = await GET(callbackRequest(CHOICE_REFERENCE));

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.rows('oauth_states').find((row) => row.state === CHOICE_REFERENCE)).toEqual(before);
  });

  it('refuses an expired login state', async () => {
    const response = await GET(callbackRequest('expired-state'));

    expect(response.headers.get('location')).toBe('https://cheers.test/connections?ads_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never puts a Meta access token from an error into the redirect or the log', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Bad token EAABsbCS1iHgBAKZCZBZCxyz0123456789', type: 'OAuthException', code: 190 } }),
        { status: 400 },
      ),
    );

    const response = await GET(callbackRequest());

    const location = response.headers.get('location') ?? '';
    expect(decodeURIComponent(location)).toContain('Bad token [redacted token]');
    expect(location).not.toContain('EAABsbCS1iHg');
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain('EAABsbCS1iHg');
  });
});
