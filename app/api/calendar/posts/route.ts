import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, badRequest, unauthorized, serverError } from '@/lib/http'

type CalendarItem = {
  id: string
  scheduled_for?: string | null
  [key: string]: unknown
}

type QueueRow = {
  scheduled_for: string | null
  campaign_posts?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isCalendarItem = (value: unknown): value is CalendarItem =>
  isRecord(value) && typeof value.id === 'string'

const isQueueRow = (value: unknown): value is QueueRow =>
  isRecord(value) &&
  'scheduled_for' in value &&
  (typeof value.scheduled_for === 'string' || value.scheduled_for === null)

const extractCampaignPost = (value: QueueRow): CalendarItem | null => {
  const { campaign_posts } = value
  if (!campaign_posts) return null
  if (Array.isArray(campaign_posts)) {
    const [first] = campaign_posts
    return isCalendarItem(first) ? first : null
  }
  return isCalendarItem(campaign_posts) ? campaign_posts : null
}

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
      tenantId = typeof membership?.tenant_id === 'string' ? membership.tenant_id : null
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
        .eq('campaign.tenant_id', tenantId)
        .not('scheduled_for', 'is', null)
        .gte('scheduled_for', from)
        .lte('scheduled_for', to)
        .order('scheduled_for', { ascending: true })
    ])

    const baseRowsRaw = [...(cpA.data ?? []), ...(cpB.data ?? [])]
    const baseRows = baseRowsRaw.filter(isCalendarItem)

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
        .eq('campaign_posts.campaign.tenant_id', tenantId)
        .gte('scheduled_for', from)
        .lte('scheduled_for', to)
        .order('scheduled_for', { ascending: true })
    ])

    const queueRowsRaw = [...(qA.data ?? []), ...(qB.data ?? [])]
    const queueRows = queueRowsRaw.filter(isQueueRow)
    const byId = new Map<string, CalendarItem>()
    for (const p of baseRows) byId.set(p.id, p)
    for (const q of queueRows) {
      const cp = extractCampaignPost(q)
      if (!cp) continue
      if (!byId.has(cp.id)) {
        byId.set(cp.id, { ...cp, scheduled_for: q.scheduled_for })
      }
    }
    const items = Array.from(byId.values())
    return ok({ items }, request)
  } catch (error) {
    return serverError('Failed to load calendar posts', error instanceof Error ? { message: error.message } : error, request)
  }
}
