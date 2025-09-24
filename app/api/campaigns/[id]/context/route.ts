import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'

type TenantRow = { tenant_id: string | null }
type CampaignRow = {
  id: string
  tenant_id: string | null
  name: string
  campaign_type: string | null
  event_date: string | null
  hero_image: { file_url: string | null } | null
  selected_timings: string[] | null
  custom_dates: string[] | null
}
type ConnectionRow = { platform: string }
type BrandProfileRow = {
  id: string
  tenant_id: string | null
  [key: string]: unknown
}
type CampaignPostRow = {
  id: string
  platform: string | null
  [key: string]: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isCampaignPostRow = (value: unknown): value is CampaignPostRow => {
  if (!isRecord(value)) return false
  const { id, platform } = value
  return typeof id === 'string' && (typeof platform === 'string' || platform === null || typeof platform === 'undefined')
}

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
      const { data: urow } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle<TenantRow>()
      if (!urow?.tenant_id) {
        const { data: membership } = await supabase
          .from('user_tenants')
          .select('tenant_id, role, created_at')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle<{ tenant_id: string | null }>()
        if (typeof membership?.tenant_id === 'string') {
          await supabase.from('users').update({ tenant_id: membership.tenant_id }).eq('id', user.id)
          logger.info('context: hydrated users.tenant_id from membership', { tenantId: membership.tenant_id })
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.warn('context: tenant hydration step failed', { error: err })
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, tenant_id, name, campaign_type, event_date, hero_image:media_assets!campaigns_hero_image_id_fkey(file_url), selected_timings, custom_dates')
      .eq('id', id)
      .maybeSingle<CampaignRow>()

    if (!campaign) return notFound('Campaign not found', undefined, request)

    const tenantId = typeof campaign.tenant_id === 'string' ? campaign.tenant_id : null

    // Connected platforms
    let conns: ConnectionRow[] = []
    if (tenantId) {
      const { data } = await supabase
        .from('social_connections')
        .select('platform')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
      conns = data ?? []
    }
    const platforms = [...new Set(
      conns
        .map(connection => (connection.platform === 'instagram' ? 'instagram_business' : connection.platform))
        .filter((platform): platform is string => Boolean(platform))
    )]

    // Brand profile
    let brandProfile: BrandProfileRow | null = null
    if (tenantId) {
      const { data: bp } = await supabase
        .from('brand_profiles')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle<BrandProfileRow>()
      brandProfile = bp ?? null
    }

    // Posts
    const { data: rawPosts } = await supabase
      .from('campaign_posts')
      .select('*')
      .eq('campaign_id', id)
      .order('scheduled_for')

    // Map DB platform values to UI variants (instagram -> instagram_business)
    const posts = (rawPosts ?? [])
      .filter(isCampaignPostRow)
      .map((post) => ({
        ...post,
        platform: post.platform === 'instagram' ? 'instagram_business' : post.platform,
      }))

    const res = { campaign, tenantId, platforms, brandProfile, posts }
    logger.apiResponse('GET', `/api/campaigns/${id}/context`, 200, 0, { area: 'campaigns', op: 'context', status: 'ok', hasPosts: posts.length > 0, platforms: platforms.length })
    return ok(res, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('context: unhandled error', { error: err })
    return serverError('Unexpected error', { message: err.message }, request)
  }
}
