import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/server-only';
import { getBaseUrl } from '@/lib/utils/get-app-url';
import { getUser } from '@/lib/supabase/auth';
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client';
import { encryptToken } from '@/lib/security/encryption';
import { consumeOAuthState } from '@/lib/security/oauth-state';
import { createRequestLogger, logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request);
  const baseUrl = getBaseUrl();
  const buildRedirect = (path: string | undefined, params: Record<string, string>) => {
    const targetPath = path && path.startsWith('/') ? path : '/settings/connections';
    const url = new URL(targetPath, `${baseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return NextResponse.redirect(url.toString());
  };
  const defaultRedirect = (params: Record<string, string>) => buildRedirect(undefined, params);

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      reqLogger.warn('Google Business Profile returned error', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        meta: { error: errorParam },
      });
      return defaultRedirect({ error: errorParam });
    }

    if (!code || !state) {
      reqLogger.warn('Missing OAuth parameters for GMB callback', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        meta: { hasCode: Boolean(code), hasState: Boolean(state) },
      });
      return defaultRedirect({ error: 'missing_parameters' });
    }

    let nonce: string;
    try {
      nonce = Buffer.from(state, 'base64').toString('utf8');
    } catch (error) {
      reqLogger.warn('Failed to decode GMB OAuth state', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return defaultRedirect({ error: 'invalid_state' });
    }

    const storedState = consumeOAuthState(nonce);
    if (!storedState) {
      reqLogger.warn('Expired or missing GMB OAuth state', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        meta: { nonce },
      });
      return defaultRedirect({ error: 'state_expired' });
    }

    const redirectWithState = (params: Record<string, string>) => buildRedirect(storedState.redirectPath || undefined, params);

    const { user } = await getUser();
    if (!user || (storedState.userId && storedState.userId !== user.id)) {
      reqLogger.warn('User mismatch during GMB callback', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        meta: { hasUser: Boolean(user), expectedUserId: storedState.userId, actualUserId: user?.id },
      });
      return defaultRedirect({ error: 'not_authenticated' });
    }

    const supabase = await createClient();
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (profileError || !userProfile?.tenant_id) {
      reqLogger.error('GMB callback: user has no tenant', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        error: profileError ?? undefined,
      });
      return redirectWithState({ error: 'invalid_tenant' });
    }

    if (userProfile.tenant_id !== storedState.tenantId) {
      reqLogger.warn('GMB callback tenant mismatch', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        meta: { expectedTenantId: storedState.tenantId, actualTenantId: userProfile.tenant_id },
      });
      return redirectWithState({ error: 'invalid_tenant' });
    }

    const tenantId = userProfile.tenant_id;
    const client = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${baseUrl}/api/auth/google-my-business/callback`,
    });

    let tokens;
    try {
      tokens = await client.exchangeCodeForTokens(code);
    } catch (error) {
      reqLogger.error('Failed to exchange GMB code for tokens', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      const detail = Buffer.from((error as Error)?.message || 'token_exchange_failed').toString('base64');
      return redirectWithState({ error: 'token_exchange_failed', detail });
    }

    const clientWithTokens = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${baseUrl}/api/auth/google-my-business/callback`,
      accessToken: tokens.accessToken,
    });

    let accounts;
    try {
      accounts = await clientWithTokens.getAccounts();
    } catch (error) {
      reqLogger.error('Failed to fetch GMB accounts', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) {
        try {
          const serviceSupabase = await createServiceRoleClient();
          await serviceSupabase
            .from('social_connections')
            .upsert({
              tenant_id: tenantId,
              platform: 'google_my_business',
              account_id: 'pending',
              account_name: 'Pending Approval',
              access_token: null,
              refresh_token: null,
              access_token_encrypted: tokens?.accessToken ? encryptToken(tokens.accessToken) : null,
              refresh_token_encrypted: tokens?.refreshToken ? encryptToken(tokens.refreshToken) : null,
              token_encrypted_at: new Date().toISOString(),
              token_expires_at: tokens?.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null,
              is_active: false,
              page_id: null,
              page_name: null,
              metadata: { status: 'pending_quota_approval' },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'tenant_id,platform,account_id' });
        } catch (pendingError) {
          reqLogger.warn('Failed to persist pending GMB connection', {
            area: 'auth',
            op: 'gmb.callback',
            status: 'fail',
            error: pendingError instanceof Error ? pendingError : new Error(String(pendingError)),
          });
        }
      }
      const detail = Buffer.from(message).toString('base64');
      return redirectWithState({ error: 'account_fetch_failed', detail });
    }

    if (!accounts || accounts.length === 0) {
      return redirectWithState({ error: 'no_accounts' });
    }

    const account = accounts[0];
    const accountName = account.name || (account as any).accountName || account.accountId;

    let locations;
    try {
      locations = await clientWithTokens.getLocations(accountName);
    } catch (error) {
      reqLogger.error('Failed to fetch GMB locations', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      const detail = Buffer.from(error instanceof Error ? error.message : String(error)).toString('base64');
      return redirectWithState({ error: 'locations_fetch_failed', detail });
    }

    const location = locations?.[0];
    if (!location) {
      return redirectWithState({ error: 'no_locations' });
    }

    const serviceSupabase = await createServiceRoleClient();
    const { error: dbError } = await serviceSupabase
      .from('social_connections')
      .upsert({
        tenant_id: tenantId,
        platform: 'google_my_business',
        account_id: accountName,
        account_name: (account as any).accountName || account.name || (account as any).title,
        access_token: null,
        refresh_token: null,
        access_token_encrypted: encryptToken(tokens.accessToken),
        refresh_token_encrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        token_encrypted_at: new Date().toISOString(),
        token_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        is_active: true,
        page_id: (location as any)?.name || (location as any)?.locationId,
        page_name: (location as any)?.locationName || (location as any)?.title,
        metadata: {
          location_id: (location as any)?.name || (location as any)?.locationId,
          location_name: (location as any)?.locationName || (location as any)?.title,
          account_resource_name: accountName,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,platform,account_id' });

    if (dbError) {
      const detail = Buffer.from(dbError.message || 'storage_failed').toString('base64');
      reqLogger.error('Failed to store GMB connection', {
        area: 'auth',
        op: 'gmb.callback',
        status: 'fail',
        error: dbError,
      });
      return redirectWithState({ error: 'storage_failed', detail });
    }

    reqLogger.info('Google Business Profile connection stored', {
      area: 'auth',
      op: 'gmb.callback',
      status: 'ok',
      meta: { tenantId, accountName },
    });

    return redirectWithState({ success: 'google_my_business_connected' });
  } catch (error) {
    reqLogger.error('GMB OAuth callback failed', {
      area: 'auth',
      op: 'gmb.callback',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    logger.error('GMB OAuth callback error', {
      area: 'auth',
      op: 'gmb.callback',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    const detail = Buffer.from((error as Error)?.message || 'oauth_failed').toString('base64');
    return defaultRedirect({ error: 'oauth_failed', detail });
  }
}
