import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/server-only";
import { encryptToken } from "@/lib/security/encryption";
import { getBaseUrl } from '@/lib/utils/get-app-url';
import { consumeOAuthState } from '@/lib/security/oauth-state'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'
import type { DatabaseWithoutInternals } from '@/lib/database.types'

const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";
const FB_VERSION = "v23.0";

type FacebookTokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
}

type FacebookProfileResponse = {
  id: string
  name?: string
}

type FacebookPage = {
  id: string
  name: string
  access_token: string
}

type FacebookAccountsResponse = {
  data?: FacebookPage[]
}

type InstagramAccountResponse = {
  instagram_business_account?: {
    id: string
    username?: string
    profile_picture_url?: string
    followers_count?: number
  }
}

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  const baseUrl = getBaseUrl()
  const buildRedirect = (path: string | undefined, params: Record<string, string>) => {
    const targetPath = path && path.startsWith('/') ? path : '/settings/connections'
    const url = new URL(targetPath, `${baseUrl}/`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return NextResponse.redirect(url.toString())
  }

  const defaultRedirect = (params: Record<string, string>) => buildRedirect(undefined, params)

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const errorParam = searchParams.get("error")

    if (errorParam) {
      reqLogger.warn('OAuth provider returned error', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        meta: { error: errorParam },
      })
      return defaultRedirect({ error: 'auth_failed' })
    }

    if (!code || !state) {
      reqLogger.warn('Missing OAuth parameters', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        meta: { hasCode: Boolean(code), hasState: Boolean(state) },
      })
      return defaultRedirect({ error: 'invalid_request' })
    }

    let nonce: string
    try {
      nonce = Buffer.from(state, 'base64').toString('utf8')
    } catch (error) {
      reqLogger.warn('Failed to decode OAuth state', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return defaultRedirect({ error: 'invalid_state' })
    }

    const storedState = await consumeOAuthState(nonce)
    if (!storedState) {
      reqLogger.warn('OAuth state missing or expired', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        meta: { nonce },
      })
      return defaultRedirect({ error: 'state_expired' })
    }

    const { tenantId: expectedTenantId, userId: expectedUserId, redirectPath, platform: requestedPlatform } = storedState
    const redirectWithState = (params: Record<string, string>) => buildRedirect(redirectPath || undefined, params)

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || (expectedUserId && user.id !== expectedUserId)) {
      reqLogger.warn('Authenticated user mismatch during OAuth callback', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        meta: { hasUser: Boolean(user), expectedUserId, actualUserId: user?.id },
      })
      return redirectWithState({ error: 'not_authenticated' })
    }

    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile?.tenant_id) {
      reqLogger.error('User missing tenant during OAuth callback', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        error: profileError ?? undefined,
      })
      return redirectWithState({ error: 'no_tenant' })
    }

    if (userProfile.tenant_id !== expectedTenantId) {
      reqLogger.warn('Tenant mismatch during OAuth callback', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        meta: { expectedTenantId, actualTenantId: userProfile.tenant_id },
      })
      return redirectWithState({ error: 'invalid_tenant' })
    }

    const tenantId = userProfile.tenant_id
    const platform = (requestedPlatform || 'facebook').toLowerCase()
    const redirectUri = `${getBaseUrl()}/api/social/callback`

    const serviceFetch = createServiceFetch('facebook')
    const fetchFacebook = async (url: string, init?: RequestInit) => {
      return withRetry(async () => await serviceFetch(url, init), {
        maxAttempts: 3,
        initialDelay: 500,
        maxDelay: 2000,
      })
    }

    const fetchFacebookJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
      const response = await fetchFacebook(url, init)
      const json = await response.json()
      if (!response.ok) {
        const apiError: Error & { status?: number; body?: unknown } = new Error(`Facebook API error ${response.status}`)
        apiError.status = response.status
        apiError.body = json
        throw apiError
      }
      return json as T
    }

    const tokenUrl = `https://graph.facebook.com/${FB_VERSION}/oauth/access_token?` +
      `client_id=${FACEBOOK_APP_ID}&` +
      `client_secret=${FACEBOOK_APP_SECRET}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `code=${encodeURIComponent(code)}`

    let shortTokenData: FacebookTokenResponse
    try {
      shortTokenData = await fetchFacebookJson<FacebookTokenResponse>(tokenUrl)
    } catch (error) {
      reqLogger.error('Failed to exchange Facebook code for token', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return redirectWithState({ error: 'token_failed' })
    }

    const longTokenUrl = `https://graph.facebook.com/${FB_VERSION}/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${FACEBOOK_APP_ID}&` +
      `client_secret=${FACEBOOK_APP_SECRET}&` +
      `fb_exchange_token=${encodeURIComponent(shortTokenData.access_token)}`

    let longTokenData: FacebookTokenResponse = shortTokenData
    try {
      longTokenData = await fetchFacebookJson<FacebookTokenResponse>(longTokenUrl)
    } catch (error) {
      reqLogger.warn('Failed to exchange long-lived Facebook token, continuing with short token', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }

    const accessToken = longTokenData.access_token || shortTokenData.access_token
    const expiresIn = longTokenData.expires_in || shortTokenData.expires_in || null

    try {
      const profile = await fetchFacebookJson<FacebookProfileResponse>(
        `https://graph.facebook.com/${FB_VERSION}/me?access_token=${encodeURIComponent(accessToken)}&fields=id,name`
      )
      reqLogger.info('Facebook user connected', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'ok',
        meta: { facebookUserId: profile.id, platform },
      })
    } catch (error) {
      reqLogger.warn('Failed to fetch Facebook profile details', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }

    const pagesData = await fetchFacebookJson<FacebookAccountsResponse>(
      `https://graph.facebook.com/${FB_VERSION}/me/accounts?access_token=${encodeURIComponent(accessToken)}&fields=id,name,access_token`
    )

    const pages = Array.isArray(pagesData?.data) ? pagesData.data : []
    if (pages.length === 0) {
      reqLogger.warn('No Facebook pages returned for user', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        meta: { platform },
      })
      return redirectWithState({ error: 'no_pages' })
    }

    const connections: DatabaseWithoutInternals['public']['Tables']['social_connections']['Insert'][] = []

    for (const page of pages) {
      if (platform === 'facebook') {
        connections.push({
          tenant_id: tenantId,
          platform: 'facebook',
          account_id: page.id,
          account_name: page.name,
          access_token: null,
          refresh_token: null,
          access_token_encrypted: encryptToken(page.access_token),
          page_id: page.id,
          page_name: page.name,
          is_active: true,
          token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        })
      }

      if (platform === 'instagram' || platform === 'instagram_business') {
        try {
          const igData = await fetchFacebookJson<InstagramAccountResponse>(
            `https://graph.facebook.com/${FB_VERSION}/${page.id}?fields=instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${encodeURIComponent(page.access_token)}`
          )

          const account = igData?.instagram_business_account
          if (account) {
            connections.push({
              tenant_id: tenantId,
              platform: 'instagram_business',
              account_id: account.id,
              account_name: account.username || 'Instagram Business',
              access_token: null,
              refresh_token: null,
              access_token_encrypted: encryptToken(page.access_token),
              page_id: page.id,
              page_name: page.name,
              is_active: true,
              token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
              metadata: {
                profile_picture_url: account.profile_picture_url,
                followers_count: account.followers_count,
              },
            })
          }
        } catch (error) {
          reqLogger.warn('Failed to load Instagram account for Facebook page', {
            area: 'auth',
            op: 'facebook.callback',
            status: 'fail',
            error: error instanceof Error ? error : new Error(String(error)),
            meta: { pageId: page.id },
          })
        }
      }
    }

    if (connections.length === 0) {
      if (platform === 'instagram' || platform === 'instagram_business') {
        return redirectWithState({ error: 'no_instagram_accounts' })
      }
      return redirectWithState({ error: 'no_pages' })
    }

    const serviceSupabase = await createServiceRoleClient()
    const { error: dbError } = await serviceSupabase
      .from('social_connections')
      .upsert(connections, { onConflict: 'tenant_id,platform,account_id' })

    if (dbError) {
      const errorDetail = Buffer.from(dbError.message || 'unknown_error').toString('base64')
      reqLogger.error('Failed to persist social connections', {
        area: 'auth',
        op: 'facebook.callback',
        status: 'fail',
        error: dbError,
      })
      return redirectWithState({
        error: 'storage_failed',
        details: errorDetail,
      })
    }

    reqLogger.info('Stored social connections successfully', {
      area: 'auth',
      op: 'facebook.callback',
      status: 'ok',
      meta: { connectionCount: connections.length, platform },
    })

    return redirectWithState({ success: 'true' })
  } catch (error) {
    reqLogger.error('Facebook OAuth callback failed', {
      area: 'auth',
      op: 'facebook.callback',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    logger.error('Facebook OAuth callback error', {
      area: 'auth',
      op: 'facebook.callback',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return defaultRedirect({ error: 'callback_failed' })
  }
}
