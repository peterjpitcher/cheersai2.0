import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=${encodeURIComponent(error)}`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=missing_parameters`
      );
    }

    // Verify state to prevent CSRF
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`
      );
    }

    // Exchange code for tokens
    const client = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-my-business/callback`,
    });

    const tokens = await client.exchangeCodeForTokens(code);

    // Get account information
    const clientWithTokens = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-my-business/callback`,
      accessToken: tokens.accessToken,
    });

    const accounts = await clientWithTokens.getAccounts();
    if (!accounts || accounts.length === 0) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=no_accounts`
      );
    }

    // Get locations for the first account
    const account = accounts[0];
    const locations = await clientWithTokens.getLocations(account.accountId);
    const location = locations[0]; // Use first location for now

    // Store the connection in database
    const supabase = await createClient();
    const { error: dbError } = await supabase
      .from('social_accounts')
      .upsert({
        tenant_id: tenantId,
        platform: 'google_my_business',
        account_id: account.accountId,
        account_name: account.name,
        location_id: location?.locationId,
        location_name: location?.title,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        is_active: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,platform',
      });

    if (dbError) {
      console.error('Error storing Google My Business connection:', dbError);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=storage_failed`
      );
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?success=google_my_business_connected`
    );
  } catch (error) {
    console.error('Google My Business OAuth error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=oauth_failed`
    );
  }
}