import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/datetime'
import { unauthorized, badRequest, notFound, forbidden, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { captureException } from '@/lib/observability/sentry'
import type { Json } from '@/lib/database.types'

type Check = { id: string; label: string; ok: boolean; hint?: string }

type SocialConnectionRecord = {
  id: string
  tenant_id: string | null
  platform: string
  account_id: string | null
  access_token: string | null
  access_token_encrypted?: string | null
  token_expires_at: string | null
  page_id: string | null
  metadata: unknown
}

type ConnectionMetadata = {
  instagram_business_account_id?: string
  scopes?: string[]
}

function parseMetadata(raw: unknown): ConnectionMetadata {
  if (!raw || typeof raw !== 'object') return {}
  const data = raw as Record<string, unknown>
  const instagramBusinessAccountId = typeof data.instagram_business_account_id === 'string'
    ? data.instagram_business_account_id
    : undefined
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter((scope): scope is string => typeof scope === 'string')
    : undefined
  return {
    instagram_business_account_id: instagramBusinessAccountId,
    scopes,
  }
}

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const reqLogger = createRequestLogger(req as unknown as Request)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, req)

    const { connectionId } = await req.json()
    if (!connectionId) return badRequest('validation_error', 'connectionId required', undefined, req)

    const { data: conn } = await supabase
      .from('social_connections')
      .select('id,tenant_id,platform,account_id,access_token,access_token_encrypted,token_expires_at,page_id,metadata')
      .eq('id', connectionId)
      .single<SocialConnectionRecord>()

    if (!conn) return notFound('Connection not found', undefined, req)

    // Verify user belongs to same tenant
    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userRow?.tenant_id || userRow.tenant_id !== conn.tenant_id) {
      return forbidden('Forbidden', undefined, req)
    }

    const checks: Check[] = []
    const now = new Date()
    const platform = conn.platform

    // Generic checks
    checks.push({ id: 'token_present', label: 'Access token present', ok: !!conn.access_token_encrypted || !!conn.access_token })
    checks.push({ id: 'token_not_expired', label: 'Access token not expired', ok: !conn.token_expires_at || new Date(conn.token_expires_at) > now, hint: conn.token_expires_at ? `Expires ${formatDateTime(conn.token_expires_at)}` : undefined })

    if (platform === 'facebook') {
      checks.push({ id: 'page_id_present', label: 'Facebook Page linked', ok: !!conn.page_id })
      // Future: call Graph API to validate scopes/pages
    }

    if (platform === 'instagram' || platform === 'instagram_business') {
      // IG publishing requires linked FB Page and IG business account
      checks.push({ id: 'page_id_present', label: 'Facebook Page linked', ok: !!conn.page_id, hint: 'Instagram Business must be linked to a Facebook Page' })
      // Try to infer IG business linkage from metadata if available
      const metadata = parseMetadata(conn.metadata)
      const hasIgBiz = Boolean(metadata.instagram_business_account_id)
      checks.push({ id: 'ig_business_link', label: 'Instagram business account linked', ok: hasIgBiz, hint: hasIgBiz ? undefined : 'Re-connect and grant Instagram business permissions' })
      // Scopes
      const scopes = metadata.scopes ?? []
      const required = ['pages_manage_posts', 'instagram_content_publish']
      for (const s of required) {
        checks.push({ id: `scope_${s}`, label: `Scope: ${s}`, ok: scopes.includes(s), hint: scopes.includes(s) ? undefined : `Re-connect to grant ${s}` })
      }
    }

    if (platform === 'google_my_business') {
      checks.push({ id: 'account_present', label: 'Google Business account present', ok: !!conn.account_id })
      // Future: lightweight Places/Business API call
    }

    // Twitter not supported

    const allOk = checks.every(c => c.ok)
    const status: 'pass' | 'fail' | 'warning' = allOk ? 'pass' : checks.some(c => c.ok) ? 'warning' : 'fail'

    await supabase
      .from('social_connections')
      .update({
        verified_at: now.toISOString(),
        verify_status: status,
        verify_details: checks as Json,
        updated_at: now.toISOString(),
      })
      .eq('id', conn.id)

    reqLogger.event('info', { area: 'verify', op: `${platform}.verify`, status: allOk ? 'ok' : 'fail', platform, connectionId: String(conn.id), tenantId: String(conn.tenant_id || ''), msg: 'Connection verification complete' })
    return ok({ status, checks, verifiedAt: now.toISOString() }, req)
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    reqLogger.error('Verify error', {
      area: 'verify',
      op: 'connection.verify',
      status: 'fail',
      error: err,
    })
    captureException(err, { tags: { area: 'verify' } })
    logger.error('Verify error', {
      area: 'verify',
      op: 'connection.verify',
      status: 'fail',
      error: err,
    })
    return serverError('Verification failed', undefined, req)
  }
}
