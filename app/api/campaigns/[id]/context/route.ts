import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const logger = createRequestLogger(request as unknown as Request)
  logger.apiRequest('GET', `/api/campaigns/${id}/context`, { area: 'campaigns', op: 'context' })
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    // Ensure tenant available for RLS
    try {
      const { data: urow } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle()
      if (!urow?.tenant_id) {
        const { data: membership } = await supabase
          .from('user_tenants')
          .select('tenant_id, role, created_at')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (membership?.tenant_id) {
          await supabase.from('users').update({ tenant_id: membership.tenant_id }).eq('id', user.id)
          logger.info('context: hydrated users.tenant_id from membership', { tenantId: membership.tenant_id })
        }
      }
    } catch (e) {
      logger.warn('context: tenant hydration step failed', { error: e instanceof Error ? e : new Error(String(e)) })
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, tenant_id, name, campaign_type, event_date, hero_image:media_assets!campaigns_hero_image_id_fkey(file_url), selected_timings, custom_dates')
      .eq('id', id)
      .maybeSingle()

    if (!campaign) return notFound('Campaign not found', undefined, request)

    const tenantId = (campaign as any).tenant_id as string | null

    // Connected platforms
    let conns: Array<{ platform: string }> = []
    if (tenantId) {
      const { data } = await supabase
        .from('social_connections')
        .select('platform')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
      conns = data || []
    }
    const platforms = [...new Set((conns || []).map(c => c.platform === 'instagram' ? 'instagram_business' : c.platform).filter(p => p !== 'twitter'))]

    // Brand profile
    let brandProfile: any = null
    if (tenantId) {
      const { data: bp } = await supabase
        .from('brand_profiles')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      brandProfile = bp || null
    }

    // Posts
    const { data: rawPosts } = await supabase
      .from('campaign_posts')
      .select('*')
      .eq('campaign_id', id)
      .order('scheduled_for')

    // Map DB platform values to UI variants (instagram -> instagram_business)
    const posts = (rawPosts || []).map((p: any) => ({
      ...p,
      platform: p.platform === 'instagram' ? 'instagram_business' : p.platform,
    }))

    const res = { campaign, tenantId, platforms, brandProfile, posts }
    logger.apiResponse('GET', `/api/campaigns/${id}/context`, 200, 0, { area: 'campaigns', op: 'context', status: 'ok', hasPosts: (posts || []).length > 0, platforms: platforms.length })
    return ok(res, request)
  } catch (e) {
    logger.error('context: unhandled error', { error: e instanceof Error ? e : new Error(String(e)) })
    return serverError('Unexpected error', undefined, request)
  }
}
