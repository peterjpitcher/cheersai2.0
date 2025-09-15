import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIClient } from '@/lib/openai/client'
import { generatePostPrompt, POST_TIMINGS } from '@/lib/openai/prompts'
import { withRetry, PLATFORM_RETRY_CONFIGS } from '@/lib/reliability/retry'
import { preflight } from '@/lib/preflight'
import { enforcePlatformLimits } from '@/lib/utils/text'
import { ok, badRequest, unauthorized, notFound, serverError } from '@/lib/http'

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid batch generate payload', parsed.error.format(), request)
    }
    const { platforms, selectedTimings, customDates } = parsed.data

    // Load campaign + tenant context
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, tenant_id, name, campaign_type, event_date, hero_image:media_assets(file_url), selected_timings, custom_dates')
      .eq('id', resolvedParams.id)
      .single()
    if (!campaign) return notFound('Campaign not found', undefined, request)

    const tenantId = campaign.tenant_id
    const eventDate = campaign.event_date
    if (!tenantId) return badRequest('invalid_campaign', 'Campaign missing tenant', undefined, request)

    // Determine target platforms
    let targetPlatforms = Array.isArray(platforms) && platforms.length > 0 ? platforms : []
    if (targetPlatforms.length === 0) {
      const { data: conns } = await supabase
        .from('social_connections')
        .select('platform')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
      const all = (conns || []).map((c: any) => c.platform)
      targetPlatforms = [...new Set(all.map(p => p === 'instagram' ? 'instagram_business' : p))]
    }
    if (targetPlatforms.length === 0) {
      return ok({ created: 0, updated: 0, skipped: 0, failed: 0, items: [], reason: 'no_platforms' }, request)
    }

    // Determine timings and custom dates
    const tSel = Array.isArray(selectedTimings) && selectedTimings.length > 0
      ? selectedTimings
      : (Array.isArray(campaign.selected_timings) ? campaign.selected_timings : [])
    const cDates = Array.isArray(customDates) && customDates.length > 0
      ? customDates
      : (Array.isArray(campaign.custom_dates) ? campaign.custom_dates : [])

    if ((tSel?.length || 0) === 0 && (cDates?.length || 0) === 0) {
      return ok({ created: 0, updated: 0, skipped: 0, failed: 0, items: [], reason: 'no_dates' }, request)
    }

    // If timings exist but no event date to anchor them, and no custom dates provided, surface a clear reason
    if ((tSel?.length || 0) > 0 && !eventDate && (cDates?.length || 0) === 0) {
      return ok({ created: 0, updated: 0, skipped: 0, failed: 0, items: [], reason: 'no_event_date' }, request)
    }

    // Build work items
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

    // Generate + upsert per item
    const { data: brandProfile } = await supabase
      .from('brand_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const openai = getOpenAIClient()

    const results: any[] = []

    for (const w of items) {
      // Do not skip past dates — always create the row as draft so the user can adjust time

      // Idempotency: check existing row
      const { data: existing } = await supabase
        .from('campaign_posts')
        .select('id, content')
        .eq('campaign_id', campaign.id)
        .eq('platform', w.platform)
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
      }

      // Post-process: enforce limits and normalise links using brand settings
      content = enforcePlatformLimits(content, w.platform)
      try {
        const isOffer = String(campaign.campaign_type || '').toLowerCase().includes('offer')
        // For offers: remove explicit times and ensure deadline phrasing is present
        if (isOffer && typeof content === 'string') {
          // Remove explicit times like 'at 11pm' or standalone '11pm'
          content = content
            .replace(/\b(?:at|from)\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
            .replace(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
            // Remove day-of-week anchors like 'this Friday', 'next Monday', 'tonight', 'tomorrow night'
            .replace(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
            .replace(/\btonight\b/gi, '')
            .replace(/\btomorrow(\s+night)?\b/gi, '')
            .replace(/\s{2,}/g, ' ').trim()
          // Ensure we mention offer end (explicit date from campaign wizard)
          const endText = campaign.event_date
            ? `Offer ends ${new Date(campaign.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`
            : ''
          if (endText && !/offer ends/i.test(content)) {
            content = content + `\n\n${endText}`
          }
          // Normalise naming: Manager’s Special
          content = content.replace(/Manager'?s Special/gi, 'Manager’s Special')
        }
        const allowedLink = brandProfile?.booking_url || brandProfile?.website_url || ''
        const platformKey = String(w.platform || '').toLowerCase()
        if (platformKey === 'instagram_business' || platformKey === 'instagram' || platformKey === 'google_my_business') {
          // Strip URLs for IG/GBP (CTA handled elsewhere)
          content = content.replace(/https?:\/\/\S+|www\.[^\s]+/gi, '').replace(/\n{3,}/g, '\n\n').trim()
        } else if (allowedLink) {
          const hasAllowed = content.includes(allowedLink)
          const hasAnyUrl = /https?:\/\/\S+|www\.[^\s]+/i.test(content)
          if (!hasAllowed && hasAnyUrl) {
            // Replace first URL with our allowed link
            content = content.replace(/https?:\/\/\S+|www\.[^\s]+/i, allowedLink)
          } else if (!hasAllowed && !hasAnyUrl) {
            // Append our link once on a new line
            content = `${content}\n\n${allowedLink}`.trim()
          }
        }
      } catch {}

      // Same-day normaliser (Europe/London): today/tonight over day-name anchors
      try {
        const toLocalYMD = (iso: string) => {
          const d = new Date(iso)
          const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
          const dd = parts.find(p => p.type === 'day')?.value || ''
          const mm = parts.find(p => p.type === 'month')?.value || ''
          const yyyy = parts.find(p => p.type === 'year')?.value || ''
          return `${yyyy}-${mm}-${dd}`
        }
        const today = toLocalYMD(new Date().toISOString())
        const sched = toLocalYMD(w.scheduled_for)
        if (today && sched && today === sched) {
          content = content
            .replace(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, 'today')
            .replace(/\btomorrow(\s+night)?\b/gi, (_m, g1) => g1 ? 'tonight' : 'today')
        }
      } catch {}
      const pf = preflight(content, w.platform)
      if (w.platform === 'twitter' && pf.findings.some(f => f.code === 'length_twitter')) {
        content = enforcePlatformLimits(content, 'twitter')
      }

      const row = {
        campaign_id: campaign.id,
        post_timing: w.post_timing,
        content,
        scheduled_for: w.scheduled_for,
        platform: w.platform,
        status: 'draft' as const,
        // Start all generated posts in the approval workflow as 'pending'
        approval_status: 'pending' as const,
        media_url: (campaign as any).hero_image?.file_url || null,
        tenant_id: tenantId,
      }

      if (existing?.id) {
        await supabase.from('campaign_posts').update({ content: row.content, media_url: row.media_url }).eq('id', existing.id)
        results.push({ ...w, status: 'updated', fallback: usedFallback })
      } else {
        const { error: insErr } = await supabase.from('campaign_posts').insert(row)
        if (insErr) {
          results.push({ ...w, status: 'failed', error: insErr.message })
        } else {
          results.push({ ...w, status: 'created', fallback: usedFallback })
        }
      }
    }

    const tally = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {} as any)
    return ok({ ...tally, items: results }, request)
  } catch (error) {
    return serverError('Failed to batch-generate posts', undefined, request)
  }
}
