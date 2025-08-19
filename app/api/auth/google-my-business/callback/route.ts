import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client';

// Force Node.js runtime for reliable Vercel logging
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Use the request URL to determine the base URL if env var is not set
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  
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

    // Decode and verify state to prevent CSRF
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch {
      console.error('Invalid state parameter');
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
    const { user } = await getUser();
    if (!user || user.id !== userId) {
      return NextResponse.redirect(
        `${baseUrl}/auth/login`
      );
    }

    // Exchange code for tokens
    let tokens;
    try {
      console.log('GMB OAuth: Starting token exchange');
      const client = new GoogleMyBusinessClient({
        clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
        redirectUri: `${baseUrl}/api/auth/google-my-business/callback`,
      });

      tokens = await client.exchangeCodeForTokens(code);
    } catch (error) {
      console.error('Token exchange failed:', error);
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
      console.log('GMB OAuth: Fetching accounts...');
      accounts = await clientWithTokens.getAccounts();
      console.log('GMB OAuth: Found accounts:', accounts?.length || 0);
    } catch (error) {
      console.error('Account fetch failed:', error);
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
    console.log('GMB OAuth: Using account:', accountName);
    
    let locations;
    try {
      locations = await clientWithTokens.getLocations(accountName);
      console.log('GMB OAuth: Found locations:', locations?.length || 0);
    } catch (error) {
      console.error('Locations fetch failed:', error);
      const errorDetail = error instanceof Error ? error.message : String(error);
      const detail = encodeURIComponent(Buffer.from(errorDetail).toString('base64'));
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=locations_fetch_failed&detail=${detail}`
      );
    }
    
    const location = locations?.[0]; // Use first location for now

    // Store the connection in database
    const supabase = await createClient();
    
    // Store the account resource name and location resource name
    const { error: dbError } = await supabase
      .from('social_accounts')
      .upsert({
        tenant_id: tenantId,
        platform: 'google_my_business',
        account_id: accountName, // Store the resource name (e.g., "accounts/123")
        account_name: account.accountName || account.name || account.title,
        location_id: location?.name || location?.locationId, // Store location resource name
        location_name: location?.locationName || location?.title,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        is_active: true,
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
        table: 'social_accounts',
        data: {
          tenant_id: tenantId,
          platform: 'google_my_business',
          account_id: account.accountId,
          account_name: account.name,
          location_id: location?.locationId,
          location_name: location?.title
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