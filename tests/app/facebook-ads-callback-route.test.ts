import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storeMetaAdAccountToken: vi.fn(),
  adAccountUpsert: vi.fn(),
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
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { account_id: 'account-1', used_at: null }, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
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

function callbackRequest() {
  return new NextRequest('https://cheers.test/api/oauth/facebook-ads/callback?code=abc&state=state-1');
}

describe('GET /api/oauth/facebook-ads/callback', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
});
