import { NextRequest } from 'next/server'
import { ok, badRequest, unauthorized, forbidden } from '@/lib/http'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

const bodySchema = z.object({
  campaignId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    const raw = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return badRequest('validation_error', 'Invalid rebuild payload', parsed.error.format(), request)
    const { campaignId } = parsed.data

    const { data: u } = await auth.from('users').select('tenant_id').eq('id', user.id).maybeSingle()
    const tenantId = u?.tenant_id as string | undefined
    if (!tenantId) return forbidden('No tenant', undefined, request)

    const svc = await createServiceRoleClient()
    // Verify campaign belongs to tenant
    const { data: campaign } = await svc.from('campaigns').select('id, tenant_id').eq('id', campaignId).maybeSingle()
    if (!campaign || campaign.tenant_id !== tenantId) return forbidden('Campaign not found in tenant', undefined, request)

    // 1) Load scheduled & approved posts
    const { data: posts } = await svc
      .from('campaign_posts')
      .select('id, platform, scheduled_for')
      .eq('campaign_id', campaignId)
      .eq('status', 'scheduled')
      .eq('approval_status', 'approved')

    // 2) Load active connections for tenant
    const { data: conns } = await svc
      .from('social_connections')
      .select('id, platform')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    const postIds = (posts || []).map(p => p.id)
    let existing: Array<{ campaign_post_id: string; social_connection_id: string }> = []
    if (postIds.length > 0) {
      const { data: existingRows } = await svc
        .from('publishing_queue')
        .select('campaign_post_id, social_connection_id')
        .in('campaign_post_id', postIds)
        .eq('status', 'pending')
      existing = existingRows || []
    }

    const items: any[] = []
    for (const p of (posts || [])) {
      const targetPlatform = (p.platform === 'instagram' ? 'instagram_business' : p.platform) || 'facebook'
      for (const c of (conns || [])) {
        const connPlatform = c.platform === 'instagram' ? 'instagram_business' : c.platform
        if (connPlatform !== targetPlatform) continue
        const exists = existing.some(e => e.campaign_post_id === p.id && e.social_connection_id === c.id)
        if (!exists) {
          items.push({
            campaign_post_id: p.id,
            social_connection_id: c.id,
            scheduled_for: p.scheduled_for,
            status: 'pending',
          })
        }
      }
    }
    if (items.length > 0) {
      await svc.from('publishing_queue').insert(items)
    }

    // Also ensure existing pending items have time synced to post
    for (const p of (posts || [])) {
      await svc.from('publishing_queue')
        .update({ scheduled_for: p.scheduled_for, next_attempt_at: null })
        .eq('campaign_post_id', p.id)
        .eq('status', 'pending')
    }

    reqLogger.apiResponse('POST', '/api/queue/rebuild', 200, 0, { area: 'queue', op: 'rebuild', campaignId, added: items.length })
    return ok({ added: items.length }, request)
  } catch (e) {
    return badRequest('rebuild_failed', 'Failed to rebuild queue', undefined, request)
  }
}

