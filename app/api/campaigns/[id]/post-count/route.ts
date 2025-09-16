import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const logger = createRequestLogger(request as unknown as Request)
  const url = new URL(request.url)
  const platforms = (url.searchParams.get('platforms') || '').split(',').filter(Boolean)
  const timings = (url.searchParams.get('timings') || '').split(',').filter(Boolean)
  const DEBUG = url.searchParams.get('debug') === '1'
  if (DEBUG) logger.apiRequest('GET', `/api/campaigns/${id}/post-count`, { area: 'campaigns', op: 'post-count' })
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    // Ensure tenant context
    let tenantId: string | null = null
    try {
      const { data: urow } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle()
      tenantId = urow?.tenant_id || null
      if (!tenantId) {
        const { data: membership } = await supabase
          .from('user_tenants')
          .select('tenant_id, role, created_at')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        tenantId = membership?.tenant_id || null
        if (tenantId) await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id)
      }
    } catch {}

    // Count matching posts
    let query = supabase
      .from('campaign_posts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id)

    // Normalise platforms for DB (instagram_business -> instagram)
    const dbPlatforms = platforms.map(p => (p === 'instagram_business' ? 'instagram' : p))
    if (dbPlatforms.length > 0) query = query.in('platform', dbPlatforms)
    if (timings.length > 0) query = query.in('post_timing', timings)

    const { count } = await query
    const c = count || 0
    if (DEBUG) logger.apiResponse('GET', `/api/campaigns/${id}/post-count`, 200, 0, { area: 'campaigns', op: 'post-count', status: 'ok', count: c })
    return ok({ count: c }, request)
  } catch (e) {
    logger.error('post-count: unhandled error', { error: e instanceof Error ? e : new Error(String(e)) })
    return serverError('Unexpected error', undefined, request)
  }
}
