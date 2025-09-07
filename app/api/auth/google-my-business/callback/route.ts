import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/server-only';
import { getBaseUrl } from '@/lib/utils/get-app-url';
import { getUser } from '@/lib/supabase/auth';
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client';

// Force Node.js runtime for reliable Vercel logging
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Use the request URL to determine the base URL if env var is not set
  const baseUrl = getBaseUrl();
  
  console.log('=== GMB OAuth Callback Started ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Base URL:', baseUrl);
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    
    console.log('Received params:', {
      hasCode: !!code,
      hasState: !!state,
      error: error || 'none',
      codePrefix: code ? code.substring(0, 10) + '...' : 'null'
    });

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

    // Decode and verify state to prevent CSRF
    let stateData;
    try {
      console.log('Decoding state parameter...');
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      console.log('State decoded successfully:', {
        hasTenantId: !!stateData.tenantId,
        hasUserId: !!stateData.userId,
        hasStateValue: !!stateData.state
      });
    } catch (e) {
      console.error('Failed to decode state parameter:', e);
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=invalid_state`
      );
    }

    const { tenantId, userId, state: originalState } = stateData;
    
    // Verify state for CSRF protection
    if (!originalState) {
      console.error('State verification failed: no original state in data');
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=state_mismatch`
      );
    }
    
    // Verify the user matches
    console.log('Verifying user session...');
    const { user } = await getUser();
    if (!user || user.id !== userId) {
      console.error('User verification failed:', {
        hasUser: !!user,
        userIdMatch: user?.id === userId
      });
      return NextResponse.redirect(
        `${baseUrl}/auth/login`
      );
    }
    console.log('User verified successfully');

    // Resolve tenant from database and ensure it matches the state to prevent cross-tenant writes
    const supabase = await createClient();
    const { data: userProfile, error: userProfileError } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    if (userProfileError || !userProfile?.tenant_id || userProfile.tenant_id !== tenantId) {
      console.error('Tenant verification failed for GMB callback', {
        stateTenantId: tenantId,
        actualTenantId: userProfile?.tenant_id || null,
      });
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=invalid_tenant`
      );
    }

    // Exchange code for tokens
    let tokens;
    try {
      console.log('=== Starting Token Exchange ===');
      console.log('Client ID exists:', !!process.env.GOOGLE_MY_BUSINESS_CLIENT_ID);
      console.log('Client Secret exists:', !!process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET);
      console.log('Redirect URI:', `${baseUrl}/api/auth/google-my-business/callback`);
      
      const client = new GoogleMyBusinessClient({
        clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
        redirectUri: `${baseUrl}/api/auth/google-my-business/callback`,
      });

      tokens = await client.exchangeCodeForTokens(code);
      console.log('Token exchange successful:', {
        hasAccessToken: !!tokens.accessToken,
        hasRefreshToken: !!tokens.refreshToken,
        expiresIn: tokens.expiresIn
      });
    } catch (error) {
      console.error('=== TOKEN EXCHANGE FAILED ===');
      console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error('Stack trace (first 500 chars):', error.stack.substring(0, 500));
      }
      const errorDetail = error instanceof Error ? error.message : String(error);
      const detail = encodeURIComponent(Buffer.from(errorDetail).toString('base64'));
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=token_exchange_failed&detail=${detail}`
      );
    }

    // Get account information
    const clientWithTokens = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${baseUrl}/api/auth/google-my-business/callback`,
      accessToken: tokens.accessToken,
    });

    let accounts;
    try {
      console.log('=== Fetching GMB Accounts ===');
      accounts = await clientWithTokens.getAccounts();
      console.log('Accounts fetched successfully:', {
        count: accounts?.length || 0,
        hasAccounts: !!accounts && accounts.length > 0
      });
      if (accounts && accounts.length > 0) {
        console.log('First account preview:', JSON.stringify(accounts[0], null, 2).substring(0, 500));
      }
    } catch (error) {
      console.error('=== ACCOUNT FETCH FAILED ===');
      console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      // If quota/approval issue, store a pending connection so user doesn't need to re-auth later
      try {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
          const serviceSupabase = await createServiceRoleClient();
          await serviceSupabase
            .from('social_connections')
            .upsert({
              tenant_id: tenantId,
              platform: 'google_my_business',
              account_id: 'pending',
              account_name: 'Pending Approval',
              access_token: tokens?.accessToken,
              refresh_token: tokens?.refreshToken,
              token_expires_at: tokens?.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null,
              is_active: false,
              page_id: null,
              page_name: null,
              metadata: { status: 'pending_quota_approval' },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'tenant_id,platform,account_id' });
        }
      } catch (e) {
        console.warn('Failed to create pending GMB connection:', e);
      }
      const errorDetail = error instanceof Error ? error.message : String(error);
      const detail = encodeURIComponent(Buffer.from(errorDetail).toString('base64'));
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=account_fetch_failed&detail=${detail}`
      );
    }
    
    if (!accounts || accounts.length === 0) {
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=no_accounts`
      );
    }

    // Get locations for the first account
    const account = accounts[0];
    // Use the account resource name (e.g., "accounts/123456")
    const accountName = account.name || account.accountName || account.accountId;
    console.log('=== Fetching Locations ===');
    console.log('Using account resource name:', accountName);
    console.log('Account object keys:', Object.keys(account));
    
    let locations;
    try {
      locations = await clientWithTokens.getLocations(accountName);
      console.log('Locations fetched successfully:', {
        count: locations?.length || 0,
        hasLocations: !!locations && locations.length > 0
      });
      if (locations && locations.length > 0) {
        console.log('First location preview:', JSON.stringify(locations[0], null, 2).substring(0, 500));
      }
    } catch (error) {
      console.error('=== LOCATIONS FETCH FAILED ===');
      console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error('Stack trace (first 500 chars):', error.stack.substring(0, 500));
      }
      const errorDetail = error instanceof Error ? error.message : String(error);
      const detail = encodeURIComponent(Buffer.from(errorDetail).toString('base64'));
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=locations_fetch_failed&detail=${detail}`
      );
    }
    
    const location = locations?.[0]; // Use first location for now

    // Store the connection in database using service role to bypass RLS
    const serviceSupabase = await createServiceRoleClient();
    
    // Store the account resource name and location resource name
    const { error: dbError } = await serviceSupabase
      .from('social_connections')
      .upsert({
        tenant_id: tenantId,
        platform: 'google_my_business',
        account_id: accountName, // Store the resource name (e.g., "accounts/123")
        account_name: account.accountName || account.name || account.title,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        is_active: true,
        page_id: location?.name || location?.locationId, // Store location resource name in page_id field
        page_name: location?.locationName || location?.title,
        metadata: {
          location_id: location?.name || location?.locationId,
          location_name: location?.locationName || location?.title,
          account_resource_name: accountName
        },
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,platform,account_id',
      });

    if (dbError) {
      console.error('Error storing Google My Business connection:', {
        error: dbError,
        code: dbError.code,
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint,
        constraint: dbError.constraint,
        table: 'social_connections',
        data: {
          tenant_id: tenantId,
          platform: 'google_my_business',
          account_id: accountName,
          account_name: account.accountName || account.name || account.title,
          page_id: location?.name || location?.locationId,
          page_name: location?.locationName || location?.title
        }
      });
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${baseUrl}/settings/connections?success=google_my_business_connected`
    );
  } catch (error) {
    // Detailed error logging
    console.error('GMB OAuth error:', error);
    const errorDetail = error instanceof Error ? error.message : String(error);
    const detail = encodeURIComponent(Buffer.from(errorDetail).toString('base64'));
    
    return NextResponse.redirect(
      `${baseUrl}/settings/connections?error=oauth_failed&detail=${detail}`
    );
  }
}
