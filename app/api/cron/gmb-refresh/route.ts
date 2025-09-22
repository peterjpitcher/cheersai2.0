import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server-only'
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client'
import type { GoogleMyBusinessAccount, GoogleMyBusinessLocation } from '@/lib/social/google-my-business/types'
import { decryptToken } from '@/lib/security/encryption'
import { getBaseUrl } from '@/lib/utils/get-app-url'
import { unauthorized, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { withRetry } from '@/lib/reliability/retry'

export const runtime = 'nodejs'

type GMBConnectionRow = {
  id: string
  tenant_id: string | null
  refresh_token: string | null
  refresh_token_encrypted: string | null
  access_token: string | null
  access_token_encrypted: string | null
}

type AccountLike = GoogleMyBusinessAccount & Partial<{ accountName: string; title: string }>
type LocationLike = GoogleMyBusinessLocation & Partial<{ locationName: string; title: string }>

export async function GET(req: NextRequest) {
  const reqLogger = createRequestLogger(req as unknown as Request)
  try {
    // Guard: require cron secret or admin context
    const authHeader = req.headers.get('authorization');
    const cronHeader = req.headers.get('x-cron-secret');
    if (process.env.CRON_SECRET) {
      const ok = authHeader === `Bearer ${process.env.CRON_SECRET}` || cronHeader === process.env.CRON_SECRET;
      if (!ok) {
        return unauthorized('Unauthorized', undefined, req)
      }
    }
    const service = await createServiceRoleClient()
    // Find pending GMB connections
    const { data: conns, error } = await service
      .from('social_connections')
      .select('id, tenant_id, refresh_token, refresh_token_encrypted, access_token, access_token_encrypted')
      .eq('platform', 'google_my_business')
      .or('account_id.eq.pending,metadata->>status.eq.pending_quota_approval')
      .returns<GMBConnectionRow[]>()

    if (error) {
      reqLogger.error('Failed to fetch pending GMB connections', {
        area: 'social',
        op: 'gmb.refresh',
        status: 'fail',
        error,
      })
      logger.error('Fetch pending GMB connections error', {
        area: 'social',
        op: 'gmb.refresh',
        status: 'fail',
        error,
      })
      return serverError('Failed to fetch pending GMB connections', { processed: 0, reason: 'fetch_failed' }, req)
    }

    let processed = 0
    for (const c of conns ?? []) {
      try {
        if (!c.refresh_token && !c.refresh_token_encrypted) continue
        const refreshToken: string | undefined = c.refresh_token_encrypted
          ? decryptToken(c.refresh_token_encrypted)
          : c.refresh_token ?? undefined
        const accessToken: string | undefined = c.access_token_encrypted
          ? decryptToken(c.access_token_encrypted)
          : c.access_token ?? undefined
        const client = new GoogleMyBusinessClient({
          clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
          redirectUri: `${getBaseUrl()}/api/auth/google-my-business/callback`,
          refreshToken,
          accessToken,
          tenantId: c.tenant_id ?? undefined,
          connectionId: c.id,
        })

        const accounts = await withRetry(() => client.getAccounts(), {
          maxAttempts: 3,
          initialDelay: 500,
          maxDelay: 2000,
        })
        const [accountRaw] = accounts as AccountLike[]
        if (!accountRaw) continue
        const accountName = accountRaw.name || accountRaw.accountId
        if (!accountName) continue
        const accountDisplayName = accountRaw.accountName ?? accountRaw.name ?? accountRaw.title ?? 'Business Profile'

        const locations = await withRetry(() => client.getLocations(accountName), {
          maxAttempts: 3,
          initialDelay: 500,
          maxDelay: 2000,
        })
        const [locationRaw] = locations as LocationLike[]
        if (!locationRaw) continue
        const pageId = locationRaw.name ?? locationRaw.locationId
        const pageName = locationRaw.locationName ?? locationRaw.title ?? 'Business Location'

        const { error: upErr } = await service.from('social_connections').update({
          account_id: accountName,
          account_name: accountDisplayName,
          page_id: pageId,
          page_name: pageName,
          is_active: true,
          metadata: { promoted_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }).eq('id', c.id)
        if (upErr) throw upErr
        processed++
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        reqLogger.warn('GMB promotion failed for pending connection', {
          area: 'social',
          op: 'gmb.refresh',
          status: 'warn',
          error: err,
          meta: { connectionId: c.id },
        })
        logger.warn('GMB promotion failed for connection', {
          area: 'social',
          op: 'gmb.refresh',
          status: 'warn',
          error: err,
          meta: { connectionId: c.id },
        })
      }
    }

    reqLogger.info('GMB refresh cron completed', {
      area: 'social',
      op: 'gmb.refresh',
      status: 'ok',
      meta: { processed },
    })
    return ok({ processed }, req)
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    reqLogger.error('GMB refresh cron error', {
      area: 'social',
      op: 'gmb.refresh',
      status: 'fail',
      error: err,
    })
    logger.error('GMB refresh cron error', {
      area: 'social',
      op: 'gmb.refresh',
      status: 'fail',
      error: err,
    })
    return serverError('cron_failed', { message: err.message }, req)
  }
}
