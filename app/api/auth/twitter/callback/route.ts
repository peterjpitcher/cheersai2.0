import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getBaseUrl } from '@/lib/utils/get-app-url';

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';

export async function GET(request: NextRequest) {
  // Use the request URL to determine the base URL if env var is not set
  const baseUrl = getBaseUrl();
  const TWITTER_REDIRECT_URI = `${baseUrl}/api/auth/twitter/callback`;
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=${encodeURIComponent(error)}`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=missing_parameters`
      );
    }

    // Decode state to get code verifier and redirect info
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch {
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=invalid_state`
      );
    }

    const { codeVerifier, state: originalState } = stateData;
    
    // Verify state for CSRF protection
    if (!originalState) {
      console.error('State verification failed: no original state in data');
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=state_mismatch`
      );
    }

    // Exchange code for tokens using OAuth 2.0 endpoint
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: TWITTER_CLIENT_ID,
        redirect_uri: TWITTER_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Twitter token exchange error:', error);
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();

    // Get user information from x.com API
    const userResponse = await fetch('https://api.x.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
      },
    });

    let username = 'twitter_user';
    let twitterUserId = '';

    if (userResponse.ok) {
      const userData = await userResponse.json();
      username = userData.data?.username || username;
      twitterUserId = userData.data?.id || '';
    }

    // Store the connection in database for the authenticated user's tenant (use service role to avoid RLS issues)
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(`${baseUrl}/auth/login`);
    }

    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    const tenantId = userData?.tenant_id;
    if (!tenantId) {
      return NextResponse.redirect(`${baseUrl}/settings/connections?error=no_tenant`);
    }

    // Store in social_accounts table (service role)
    const service = await createServiceRoleClient();
    const { error: dbError } = await service
      .from('social_accounts')
      .upsert({
        tenant_id: tenantId,
        platform: 'twitter',
        account_id: twitterUserId,
        account_name: username,
        username: username,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokens.expires_in 
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,platform,account_id',
      });

    // Also store in social_connections for backward compatibility
    await service
      .from('social_connections')
      .upsert({
        tenant_id: tenantId,
        platform: 'twitter',
        account_name: username,
        account_id: twitterUserId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokens.expires_in 
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,platform,account_id',
      });

    if (dbError) {
      console.error('Error storing Twitter connection:', {
        error: dbError,
        code: dbError.code,
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint,
        constraint: dbError.constraint,
        table: 'social_accounts',
        data: {
          tenant_id: tenantId,
          platform: 'twitter',
          account_id: twitterUserId,
          username: username
        }
      });
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${baseUrl}/settings/connections?success=twitter_connected`
    );
  } catch (error) {
    console.error('Twitter OAuth error:', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      timestamp: new Date().toISOString()
    });
    return NextResponse.redirect(
      `${baseUrl}/settings/connections?error=oauth_failed`
    );
  }
}
