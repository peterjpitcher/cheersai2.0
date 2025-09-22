import { NextRequest } from "next/server";
import { maskToken } from "@/lib/security/encryption";
import { badRequest, forbidden, ok, serverError, unauthorized } from "@/lib/http";
import { requireSuperadmin, SuperadminRequiredError } from '@/lib/security/superadmin'
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'
import { logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

const facebookServiceFetch = createServiceFetch('facebook')
const facebookFetch = (url: string, init?: RequestInit) =>
  withRetry(() => facebookServiceFetch(url, init), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 2000,
  })

function assertSecrets() {
  const appId = process.env.INSTAGRAM_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('Instagram credentials are not configured');
  }
  return { appId, appSecret };
}

export async function GET(request: NextRequest) {
  try {
    try {
      await requireSuperadmin()
    } catch (authError) {
      if (authError instanceof SuperadminRequiredError && authError.reason === 'unauthenticated') {
        return unauthorized('Authentication required', undefined, request);
      }
      if (authError instanceof SuperadminRequiredError && authError.reason === 'forbidden') {
        return forbidden('Forbidden', undefined, request);
      }
      throw authError;
    }

    let credentials;
    try {
      credentials = assertSecrets();
    } catch (error) {
      return badRequest('missing_credentials', (error as Error).message, undefined, request);
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const redirectUri = `${baseUrl}/api/auth/callback/instagram-business`;

    const scopes = [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
      'instagram_business_content_publish',
      'instagram_business_manage_insights',
    ];

    const authUrl = new URL('https://www.instagram.com/oauth/authorize');
    authUrl.searchParams.set('client_id', credentials.appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(','));
    authUrl.searchParams.set('force_reauth', 'true');

    let appInfo: Record<string, unknown> | null = null;
    let appError: string | null = null;
    try {
      const appAccessToken = `${credentials.appId}|${credentials.appSecret}`
      const response = await facebookFetch(
        `https://graph.facebook.com/v20.0/${credentials.appId}?fields=name,link,app_id&access_token=${encodeURIComponent(appAccessToken)}`
      )
      if (response.ok) {
        appInfo = await response.json();
      } else {
        const body = await response.text();
        appError = `Graph API responded with ${response.status}: ${body.slice(0, 200)}`;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.warn('Facebook debug fetch failed', {
        area: 'debug',
        op: 'instagram.app-info',
        status: 'fail',
        error: err,
      })
      appError = err.message;
    }

    return ok({
      instagramApp: {
        appId: credentials.appId,
        secretMasked: maskToken(credentials.appSecret),
        secretConfigured: true,
      },
      oauth: {
        redirectUri,
        scopes,
        authorizationUrl: authUrl.toString(),
      },
      graphStatus: {
        appInfo,
        error: appError,
      },
    }, request);
  } catch (error) {
    return serverError('Failed to build Instagram debug payload', (error as Error).message, request);
  }
}
