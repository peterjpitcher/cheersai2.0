import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/auth';
import { getBaseUrl } from '@/lib/utils/get-app-url';
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client';
import { createRequestLogger } from '@/lib/observability/logger'
import { persistOAuthState } from '@/lib/security/oauth-state'

// Force Node.js runtime for reliable Vercel logging
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  const baseUrl = getBaseUrl();
  
  try {
    const { user, tenantId } = await getUser();
    
    if (!user || !tenantId) {
      reqLogger.warn('GBP OAuth connect attempted without valid session', {
        area: 'auth',
        op: 'gmb.connect',
        status: 'fail',
        meta: { hasUser: Boolean(user), hasTenantId: Boolean(tenantId) },
      })
      return NextResponse.redirect(`${baseUrl}/auth/login`);
    }

    const redirectPath = request.nextUrl.searchParams.get('redirect') || '/settings/connections'
    const nonce = persistOAuthState({
      tenantId,
      userId: user.id,
      redirectPath,
      platform: 'google_my_business',
    })

    const client = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${baseUrl}/api/auth/google-my-business/callback`,
    });

    const authUrl = await client.getAuthorizationUrl(Buffer.from(nonce, 'utf8').toString('base64'));

    reqLogger.info('Redirecting to Google Business Profile OAuth', {
      area: 'auth',
      op: 'gmb.connect',
      status: 'ok',
      meta: { redirectPath },
    })

    // Redirect to Google OAuth instead of returning JSON
    return NextResponse.redirect(authUrl);
  } catch (error) {
    reqLogger.error('Failed to initiate Google Business Profile OAuth', {
      area: 'auth',
      op: 'gmb.connect',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    // Redirect to connections page with error
    return NextResponse.redirect(`${baseUrl}/settings/connections?error=gmb_connect_failed`);
  }
}
