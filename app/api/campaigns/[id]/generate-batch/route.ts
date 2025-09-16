import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIClient } from '@/lib/openai/client'
import { generatePostPrompt, POST_TIMINGS } from '@/lib/openai/prompts'
import { withRetry, PLATFORM_RETRY_CONFIGS } from '@/lib/reliability/retry'
import { preflight } from '@/lib/preflight'
import { postProcessContent } from '@/lib/openai/post-processor'
import { ok, badRequest, unauthorized, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

const BodySchema = z.object({
  platforms: z.array(z.string()).optional(),
  selectedTimings: z.array(z.string()).optional(),
  customDates: z.array(z.string()).optional(),
  maxPerPlatform: z.number().optional(),
})

function timingOffset(id: string): { days?: number; hours?: number } {
  const t = POST_TIMINGS.find((x: any) => x.id === id)
  return t ? { days: (t as any).days || 0, hours: (t as any).hours || 0 } : {}
}

function addOffset(baseIso: string, off?: { days?: number; hours?: number }) {
  const d = new Date(baseIso)
  if (off?.days) d.setDate(d.getDate() + off.days)
  if (off?.hours) d.setHours(d.getHours() + (off.hours || 0))
  return d.toISOString()
}

function isOlderThan(iso: string, ms: number): boolean {
  try { return new Date(iso).getTime() < Date.now() - ms } catch { return false }
}

function relativeLabel(scheduledIso: string, eventIso: string): string {
  try {
    const sd = new Date(scheduledIso)
    const ed = new Date(eventIso)
    const dayName = ed.toLocaleDateString('en-GB', { weekday: 'long' })
    const sdY = sd.toISOString().slice(0,10)
    const edY = ed.toISOString().slice(0,10)
    if (sdY === edY) return 'today'
    const tomorrow = new Date(sd); tomorrow.setDate(sd.getDate()+1)
    if (tomorrow.toISOString().slice(0,10) === edY) return 'tomorrow'
    // same week (Mon start)
    const sMon = new Date(sd); const eMon = new Date(ed)
    const sDay = sMon.getDay(); const eDay = eMon.getDay()
    sMon.setDate(sMon.getDate() - (sDay === 0 ? 6 : sDay - 1))
    eMon.setDate(eMon.getDate() - (eDay === 0 ? 6 : eDay - 1))
    if (sMon.toDateString() === eMon.toDateString()) return `this ${dayName.toLowerCase()}`
    const nextWeek = new Date(sMon); nextWeek.setDate(sMon.getDate()+7)
    if (nextWeek.toDateString() === eMon.toDateString()) return `next ${dayName.toLowerCase()}`
    return dayName
  } catch { return 'the event day' }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    const supabase = await createClient()
    const reqLogger = createRequestLogger(request as unknown as Request)
    const DEBUG = (() => { try { return new URL(request.url).searchParams.get('debug') === '1' } catch { return false } })()
    reqLogger.apiRequest('POST', `/api/campaigns/${resolvedParams.id}/generate-batch`, { area: 'campaigns', op: 'generate-batch' })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      reqLogger.warn('generate-batch unauthorized')
      return unauthorized('Authentication required', undefined, request)
    }

    // Ensure users.tenant_id is hydrated to satisfy RLS policies using get_auth_tenant_id()
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
          reqLogger.info('generate-batch: hydrated users.tenant_id from membership', { tenantId: membership.tenant_id })
        }
      }
    } catch (e) {
      reqLogger.warn('generate-batch: tenant hydration step failed', { error: e instanceof Error ? e : new Error(String(e)) })
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid batch generate payload', parsed.error.format(), request)
    }
    const { platforms, selectedTimings, customDates } = parsed.data

    // Load campaign + tenant context
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, tenant_id, name, campaign_type, event_date, hero_image:media_assets!campaigns_hero_image_id_fkey(file_url), selected_timings, custom_dates')
      .eq('id', resolvedParams.id)
      .single()
    if (!campaign) {
      reqLogger.warn('generate-batch campaign not found', { campaignId: resolvedParams.id })
      return notFound('Campaign not found', undefined, request)
    }

    const tenantId = campaign.tenant_id
    const eventDate = campaign.event_date
    if (!tenantId) return badRequest('invalid_campaign', 'Campaign missing tenant', undefined, request)

    // Determine target platforms
    let targetPlatforms = Array.isArray(platforms) && platforms.length > 0
      ? [...new Set(platforms.map(p => p === 'instagram' ? 'instagram_business' : p).filter(p => p !== 'twitter'))]
      : []
    if (targetPlatforms.length === 0) {
      const { data: conns } = await supabase
        .from('social_connections')
        .select('platform')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
      const all = (conns || []).map((c: any) => c.platform)
      targetPlatforms = [...new Set(all.map(p => p === 'instagram' ? 'instagram_business' : p))].filter(p => p !== 'twitter')
    }
    if (DEBUG) reqLogger.info('generate-batch: platforms resolved', { platforms: targetPlatforms })
    if (targetPlatforms.length === 0) {
      reqLogger.info('generate-batch: no active platforms', { tenantId, campaignId: campaign.id })
      const res = { created: 0, updated: 0, skipped: 0, failed: 0, items: [], reason: 'no_platforms' as const }
      reqLogger.apiResponse('POST', `/api/campaigns/${resolvedParams.id}/generate-batch`, 200, 0, { area: 'campaigns', op: 'generate-batch', status: 'ok', ...res })
      return ok(res, request)
    }

    // Determine timings and custom dates
    const tSel = Array.isArray(selectedTimings) && selectedTimings.length > 0
      ? selectedTimings
      : (Array.isArray(campaign.selected_timings) ? campaign.selected_timings : [])
    const cDates = Array.isArray(customDates) && customDates.length > 0
      ? customDates
      : (Array.isArray(campaign.custom_dates) ? campaign.custom_dates : [])

    if ((tSel?.length || 0) === 0 && (cDates?.length || 0) === 0) {
      reqLogger.info('generate-batch: no timings or custom dates', { campaignId: campaign.id })
      const res = { created: 0, updated: 0, skipped: 0, failed: 0, items: [], reason: 'no_dates' as const }
      reqLogger.apiResponse('POST', `/api/campaigns/${resolvedParams.id}/generate-batch`, 200, 0, { area: 'campaigns', op: 'generate-batch', status: 'ok', ...res })
      return ok(res, request)
    }

    // If timings exist but no event date to anchor them, and no custom dates provided, surface a clear reason
    if ((tSel?.length || 0) > 0 && !eventDate && (cDates?.length || 0) === 0) {
      reqLogger.info('generate-batch: timings present but campaign has no event_date', { campaignId: campaign.id })
      const res = { created: 0, updated: 0, skipped: 0, failed: 0, items: [], reason: 'no_event_date' as const }
      reqLogger.apiResponse('POST', `/api/campaigns/${resolvedParams.id}/generate-batch`, 200, 0, { area: 'campaigns', op: 'generate-batch', status: 'ok', ...res })
      return ok(res, request)
    }

    // Build work items (use platform key for prompts; map to DB value at insert)
    type Work = { platform: string; post_timing: string; scheduled_for: string }
    const items: Work[] = []
    for (const t of tSel) {
      if (!eventDate) continue; // tolerate missing event date when only custom dates are in use
      const off = timingOffset(t)
      const sIso = addOffset(eventDate, off)
      items.push(...targetPlatforms.map(p => ({ platform: p, post_timing: t, scheduled_for: sIso })))
    }
    for (const d of cDates) {
      const sIso = new Date(d).toISOString()
      items.push(...targetPlatforms.map(p => ({ platform: p, post_timing: 'custom', scheduled_for: sIso })))
    }
    reqLogger.info('generate-batch: work items computed', { campaignId: campaign.id, items: items.length, platforms: targetPlatforms.length, timings: tSel.length, customDates: cDates.length })

    // Generate + upsert per item
    const { data: brandProfile } = await supabase
      .from('brand_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    // Load posting schedules to set time-of-day per platform/day
    let scheduleMap: Record<string, Record<number, string>> = {}
    try {
      const { data: sched } = await supabase
        .from('posting_schedules')
        .select('platform, day_of_week, time, active')
        .eq('tenant_id', tenantId)
        .eq('active', true)
      for (const row of (sched || [])) {
        const key = (row.platform === 'instagram_business' ? 'instagram' : row.platform) || 'facebook'
        scheduleMap[key] = scheduleMap[key] || {}
        scheduleMap[key][Number(row.day_of_week)] = String(row.time)
      }
      if (DEBUG) reqLogger.info('generate-batch: schedule map loaded', { platforms: Object.keys(scheduleMap) })
    } catch {}

    const openai = getOpenAIClient()

    const results: any[] = []
    let fallbackCount = 0

    for (const w of items) {
      if (DEBUG) reqLogger.info('generate-batch: item start', { platform: w.platform, postTiming: w.post_timing, scheduledFor: w.scheduled_for })
      // Do not skip past dates — always create the row as draft so the user can adjust time

      // Idempotency: check existing row (use DB platform value)
      const dbPlatform = w.platform === 'instagram_business' ? 'instagram' : w.platform
      const { data: existing } = await supabase
        .from('campaign_posts')
        .select('id, content')
        .eq('campaign_id', campaign.id)
        .eq('platform', dbPlatform)
        .eq('post_timing', w.post_timing)
        .eq('scheduled_for', w.scheduled_for)
        .maybeSingle()

      // Create prompt and call OpenAI with retry; fallback on failure
      let content = ''
      let usedFallback = false
      try {
        const campaignTypeForPrompt = (() => {
          const ct = String(campaign.campaign_type || '')
          const nm = String(campaign.name || '')
          const offerish = /offer|special/i.test(ct) || /offer|special/i.test(nm)
          return offerish && !/offer/i.test(ct) ? `${ct} offer` : ct
        })()
        const userPrompt = generatePostPrompt({
          campaignType: campaignTypeForPrompt,
          campaignName: campaign.name,
          businessName: brandProfile?.business_name || brandProfile?.name || 'Our pub',
          eventDate: new Date(eventDate),
          postTiming: w.post_timing as any,
          toneAttributes: ['friendly','welcoming'],
          businessType: brandProfile?.business_type || 'pub',
          targetAudience: brandProfile?.target_audience || 'local community',
          platform: w.platform,
          customDate: w.post_timing === 'custom' ? new Date(w.scheduled_for) : undefined,
        })
        const system = `You are a UK hospitality social media expert. Use British English. Write 2 short paragraphs separated by a single blank line. No markdown.`
        const completion = await withRetry(async () => {
          return await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ],
            temperature: 0.8,
            max_tokens: 500,
          })
        }, PLATFORM_RETRY_CONFIGS.openai, 'openai')
        content = completion.choices[0]?.message?.content || ''
      } catch (e) {
        // Fallback: simple two-paragraph copy with relative wording
        const rel = relativeLabel(w.scheduled_for, eventDate)
        const whenText = rel === 'today' ? 'tonight' : (rel === 'tomorrow' ? 'tomorrow night' : rel)
        if (String(campaign.campaign_type || '').toLowerCase().includes('offer')) {
          const endText = rel ? `Offer ends ${rel}.` : 'Limited-time offer.'
          content = `Don’t miss our Manager’s Special — a limited-time offer at ${brandProfile?.business_name || 'the pub'}. Enjoy a warm welcome and great vibes.\n\n${endText}`
        } else {
          content = `Join us ${whenText} at ${brandProfile?.business_name || 'the pub'}! Expect great vibes, friendly faces and a brilliant atmosphere.\n\nWe’ve got something special lined up — come early for food and get comfy. See you there!`
        }
        usedFallback = true
        fallbackCount++
      }

      const processed = postProcessContent({
        content,
        platform: w.platform,
        campaignType: campaign.campaign_type,
        campaignName: campaign.name,
        eventDate: campaign.event_date,
        scheduledFor: w.scheduled_for,
        brand: { booking_url: (brandProfile as any)?.booking_url, website_url: (brandProfile as any)?.website_url }
      })
      content = processed.content

      // Respect tenant posting schedule time or default to 07:00, and ensure not earlier today
      let scheduledFor = w.scheduled_for
      try {
        const now = new Date()
        const sch = new Date(scheduledFor)
        // Apply posting schedule time if available
        const dow = sch.getDay() // 0=Sun..6=Sat
        const pKey = dbPlatform // already normalised for DB
        const preferred = scheduleMap[pKey]?.[dow]
        const setLocalTime = (iso: string, hhmm: string) => {
          const d = new Date(iso)
          const [hh, mm] = hhmm.split(':').map((x: any) => parseInt(String(x), 10))
          d.setHours(isNaN(hh) ? 7 : hh, isNaN(mm) ? 0 : mm, 0, 0)
          return d.toISOString()
        }
        if (preferred) {
          scheduledFor = setLocalTime(scheduledFor, preferred)
        } else {
          // Default to 07:00 local if time is midnight
          const atMidnight = sch.getHours() === 0 && sch.getMinutes() === 0
          if (atMidnight) {
            const d = new Date(scheduledFor)
            d.setHours(7, 0, 0, 0)
            scheduledFor = d.toISOString()
          }
        }

        const sameDay = sch.toISOString().slice(0,10) === now.toISOString().slice(0,10)
        // If scheduled earlier today than now, bump by 1 hour from now
        const schAfterAdjust = new Date(scheduledFor)
        if (sameDay && schAfterAdjust.getTime() < now.getTime()) {
          const bump = new Date(now)
          bump.setMinutes(0,0,0)
          bump.setHours(bump.getHours() + 1)
          scheduledFor = bump.toISOString()
        }
      } catch {}

      const row = {
        campaign_id: campaign.id,
        post_timing: w.post_timing,
        content,
        scheduled_for: scheduledFor,
        platform: dbPlatform,
        status: 'draft' as const,
        // Start all generated posts in the approval workflow as 'pending'
        approval_status: 'pending' as const,
        media_url: (campaign as any).hero_image?.file_url || null,
        tenant_id: tenantId,
      }

      if (existing?.id) {
        await supabase.from('campaign_posts').update({ content: row.content, media_url: row.media_url }).eq('id', existing.id)
        results.push({ ...w, status: 'updated', fallback: usedFallback })
        if (DEBUG) reqLogger.info('generate-batch: item updated', { platform: w.platform, postTiming: w.post_timing, fallback: usedFallback })
      } else {
        const { error: insErr } = await supabase.from('campaign_posts').insert(row)
        if (insErr) {
          results.push({ ...w, status: 'failed', error: insErr.message })
          if (DEBUG) reqLogger.warn('generate-batch: item failed', { platform: w.platform, postTiming: w.post_timing, error: new Error(insErr.message) })
        } else {
          results.push({ ...w, status: 'created', fallback: usedFallback })
          if (DEBUG) reqLogger.info('generate-batch: item created', { platform: w.platform, postTiming: w.post_timing, fallback: usedFallback })
        }
      }
    }

    const tally = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {} as any)
    const responsePayload = { ...tally, items: results, fallbackCount }
    reqLogger.apiResponse('POST', `/api/campaigns/${resolvedParams.id}/generate-batch`, 200, 0, { area: 'campaigns', op: 'generate-batch', status: 'ok', ...responsePayload })
    return ok(responsePayload, request)
  } catch (error) {
    const reqLogger = createRequestLogger(request as unknown as Request)
    reqLogger.error('generate-batch: unhandled error', { area: 'campaigns', op: 'generate-batch', error: error instanceof Error ? error : new Error(String(error)) })
    return serverError('Failed to batch-generate posts', undefined, request)
  }
}
