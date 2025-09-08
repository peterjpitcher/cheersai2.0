import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/datetime'
import { unauthorized, badRequest, notFound, forbidden, ok, serverError } from '@/lib/http'

type Check = { id: string; label: string; ok: boolean; hint?: string }

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, req)

    const { connectionId } = await req.json()
    if (!connectionId) return badRequest('validation_error', 'connectionId required', undefined, req)

    const { data: conn } = await supabase
      .from('social_connections')
      .select('*')
      .eq('id', connectionId)
      .single()

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
      const hasIgBiz = !!(conn.metadata && (conn.metadata as any).instagram_business_account_id)
      checks.push({ id: 'ig_business_link', label: 'Instagram business account linked', ok: hasIgBiz, hint: hasIgBiz ? undefined : 'Re-connect and grant Instagram business permissions' })
      // Scopes
      const scopes: string[] = Array.isArray((conn.metadata as any)?.scopes) ? (conn.metadata as any).scopes : []
      const required = ['pages_manage_posts', 'instagram_content_publish']
      for (const s of required) {
        checks.push({ id: `scope_${s}`, label: `Scope: ${s}`, ok: scopes.includes(s), hint: scopes.includes(s) ? undefined : `Re-connect to grant ${s}` })
      }
    }

    if (platform === 'google_my_business') {
      checks.push({ id: 'account_present', label: 'Google Business account present', ok: !!conn.account_id })
      // Future: lightweight Places/Business API call
    }

    if (platform === 'twitter') {
      checks.push({ id: 'account_present', label: 'Twitter/X account present', ok: !!conn.account_id })
    }

    const allOk = checks.every(c => c.ok)
    const status: 'pass' | 'fail' | 'warning' = allOk ? 'pass' : checks.some(c => c.ok) ? 'warning' : 'fail'

    await supabase
      .from('social_connections')
      .update({
        verified_at: now.toISOString(),
        verify_status: status,
        verify_details: checks as any,
        updated_at: now.toISOString(),
      })
      .eq('id', conn.id)

    return ok({ status, checks, verifiedAt: now.toISOString() }, req)
  } catch (e) {
    console.error('Verify error:', e)
    return serverError('Verification failed', undefined, req)
  }
}
