import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, badRequest, unauthorized, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to) {
      return badRequest('validation_error', 'Missing from/to query params', undefined, request)
    }

    // Resolve tenant id (users.tenant_id -> membership fallback)
    const { data: userRow } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle()
    let tenantId: string | null = userRow?.tenant_id || null
    if (!tenantId) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id, role, created_at')
        .eq('user_id', user.id)
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      tenantId = (membership?.tenant_id as string) || null
    }
    if (!tenantId) return badRequest('no_tenant', 'No tenant resolved for user', undefined, request)

    // Query posts by tenant directly
    const selectBase = `
      id,
      content,
      scheduled_for,
      status,
      approval_status,
      platform,
      platforms,
      is_quick_post,
      media_url,
      media_assets,
      campaign:campaigns!inner(
        id,
        name,
        status,
        event_date,
        tenant_id
      )
    `

    const [cpA, cpB] = await Promise.all([
      supabase
        .from('campaign_posts')
        .select(selectBase)
        .eq('tenant_id', tenantId)
        .not('scheduled_for', 'is', null)
        .gte('scheduled_for', from)
        .lte('scheduled_for', to)
        .order('scheduled_for', { ascending: true }),
      // Fallback: rows with null tenant_id, but campaign is in tenant (via inner join)
      supabase
        .from('campaign_posts')
        .select(selectBase)
        .is('tenant_id', null)
        .eq('campaign.tenant_id', tenantId as any)
        .not('scheduled_for', 'is', null)
        .gte('scheduled_for', from)
        .lte('scheduled_for', to)
        .order('scheduled_for', { ascending: true })
    ])

    const baseRows = ([] as any[]).concat(cpA.data || [], cpB.data || [])

    // Also include publishing queue items in range (avoid duplicates by campaign_post id)
    const selectQueue = `
      id,
      scheduled_for,
      campaign_posts!inner (
        id,
        content,
        tenant_id,
        status,
        approval_status,
        platform,
        platforms,
        is_quick_post,
        media_url,
        media_assets,
        campaign:campaigns!inner(
          id,
          name,
          status,
          event_date,
          tenant_id
        )
      )
    `

    const [qA, qB] = await Promise.all([
      supabase
        .from('publishing_queue')
        .select(selectQueue)
        .eq('campaign_posts.tenant_id', tenantId)
        .gte('scheduled_for', from)
        .lte('scheduled_for', to)
        .order('scheduled_for', { ascending: true }),
      supabase
        .from('publishing_queue')
        .select(selectQueue)
        .is('campaign_posts.tenant_id', null)
        .eq('campaign_posts.campaign.tenant_id', tenantId as any)
        .gte('scheduled_for', from)
        .lte('scheduled_for', to)
        .order('scheduled_for', { ascending: true })
    ])

    const queueRows = ([] as any[]).concat(qA.data || [], qB.data || [])
    const byId = new Map<string, any>()
    for (const p of baseRows) byId.set(p.id, p)
    for (const q of queueRows) {
      const cp = Array.isArray(q.campaign_posts) ? q.campaign_posts[0] : q.campaign_posts
      if (!cp) continue
      if (!byId.has(cp.id)) {
        byId.set(cp.id, { ...cp, scheduled_for: q.scheduled_for })
      }
    }
    const items = Array.from(byId.values())
    return ok({ items }, request)
  } catch (e) {
    return serverError('Failed to load calendar posts', undefined, request)
  }
}

