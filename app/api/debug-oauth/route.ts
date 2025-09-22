import { NextRequest } from 'next/server'
import { badRequest, forbidden, ok, serverError, unauthorized } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'
import { requireSuperadmin, SuperadminRequiredError } from '@/lib/security/superadmin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)

  try {
    try {
      await requireSuperadmin()
    } catch (error) {
      if (error instanceof SuperadminRequiredError && error.reason === 'unauthenticated') {
        return unauthorized('Authentication required', undefined, request)
      }
      if (error instanceof SuperadminRequiredError && error.reason === 'forbidden') {
        return forbidden('Forbidden', undefined, request)
      }
      throw error
    }

    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID
    if (!appId) {
      return badRequest('missing_credentials', 'Facebook App ID is not configured', undefined, request)
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`
    const redirectUri = `${baseUrl}/api/social/callback`

    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'public_profile',
    ]

    const authUrl = new URL('https://www.facebook.com/v20.0/dialog/oauth')
    authUrl.searchParams.set('client_id', appId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scopes.join(','))

    const payload = {
      facebookAppIdMasked: appId.replace(/.(?=.{4})/g, '*'),
      environment: {
        appUrl: process.env.NEXT_PUBLIC_APP_URL || 'NOT SET',
        requestHost: request.nextUrl.host,
        protocol: request.nextUrl.protocol,
      },
      redirectUris: {
        actual: redirectUri,
        expected: redirectUri,
      },
      fullOauthUrl: authUrl.toString(),
      requiredFacebookSettings: {
        validOauthRedirectUris: [
          `${baseUrl}/api/social/callback`,
          `${baseUrl}/api/auth/callback/instagram-business`,
        ],
        appDomains: [new URL(baseUrl).host],
        siteUrl: baseUrl,
        clientOauthLogin: 'ON',
        webOauthLogin: 'ON',
      },
    }

    reqLogger.info('Facebook OAuth debug payload generated', {
      area: 'debug',
      op: 'oauth.facebook',
      status: 'ok',
      meta: { hasAppId: Boolean(appId) },
    })

    return ok(payload, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to build Facebook OAuth debug payload', {
      area: 'debug',
      op: 'oauth.facebook',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to build Facebook OAuth debug payload', undefined, request)
  }
}
