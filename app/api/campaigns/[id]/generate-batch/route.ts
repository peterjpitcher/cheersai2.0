import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatTime } from '@/lib/datetime'
import { getOpenAIClient } from '@/lib/openai/client'
import {
  POST_TIMINGS,
  buildBrandVoiceSummary,
  buildStructuredPostPrompt,
  defaultCtasForPlatform,
  deriveToneDescriptors,
  getRelativeTimingLabel,
  toOpeningHoursRecord,
  type OpeningHoursRecord,
  type TimingKey,
} from '@/lib/openai/prompts'
import { withRetry, PLATFORM_RETRY_CONFIGS } from '@/lib/reliability/retry'
import { postProcessContent } from '@/lib/openai/post-processor'
import { ok, badRequest, unauthorized, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'
import type { DatabaseWithoutInternals } from '@/lib/database.types'

export const runtime = 'nodejs'

const BodySchema = z.object({
  platforms: z.array(z.string()).optional(),
  selectedTimings: z.array(z.string()).optional(),
  customDates: z.array(z.string()).optional(),
  maxPerPlatform: z.number().optional(),
})

type CampaignRecord = {
  id: string
  tenant_id: string | null
  name: string | null
  campaign_type: string | null
  event_date: string | null
  hero_image: { file_url: string | null } | null
  selected_timings: string[] | null
  custom_dates: string[] | null
  description?: string | null
  primary_cta?: string | null
}

type SocialConnectionRow = { platform: string | null }

type PostingScheduleRow = {
  platform: string | null
  day_of_week: number | null
  time: string | null
  active: boolean | null
}

type BrandProfileRow = {
  business_name?: string | null
  business_type?: string | null
  target_audience?: string | null
  brand_identity?: string | null
  brand_voice?: string | null
  tone_attributes?: string[] | null
  booking_url?: string | null
  website_url?: string | null
  opening_hours?: OpeningHoursRecord | null
  menu_food_url?: string | null
  menu_drink_url?: string | null
  serves_food?: boolean | null
  serves_drinks?: boolean | null
  content_boundaries?: string[] | null
  phone?: string | null
  phone_e164?: string | null
  whatsapp?: string | null
  whatsapp_e164?: string | null
}

type BrandVoiceProfileRow = {
  tone_attributes?: string[] | null
  characteristics?: string[] | null
  avg_sentence_length?: number | null
  emoji_usage?: boolean | null
  emoji_frequency?: string | null
}

type GuardrailRow = {
  id: string
  feedback_type: 'avoid' | 'include' | 'tone' | 'style' | 'format'
  feedback_text: string
}

type Work = { platform: string; post_timing: TimingKey; scheduled_for: string }
type ResultStatus = 'created' | 'updated' | 'failed'
type ResultItem = Work & { status: ResultStatus; fallback?: boolean; error?: string }

type AiPromptRow = DatabaseWithoutInternals['public']['Tables']['ai_platform_prompts']['Row']

const unique = (values: Array<string | null | undefined>) => {
  const set = new Set<string>()
  for (const value of values) {
    if (!value) continue
    const cleaned = value.replace(/\s+/g, ' ').trim()
    if (cleaned) set.add(cleaned)
  }
  return Array.from(set)
}

const mergeGuardrails = (guardrails: GuardrailRow[], boundaries?: string[] | null) => ({
  mustInclude: unique(guardrails.filter(g => g.feedback_type === 'include').map(g => g.feedback_text)),
  mustAvoid: unique([
    ...guardrails.filter(g => g.feedback_type === 'avoid').map(g => g.feedback_text),
    ...(boundaries ?? []),
  ]),
  tone: unique(guardrails.filter(g => g.feedback_type === 'tone').map(g => g.feedback_text)),
  style: unique(guardrails.filter(g => g.feedback_type === 'style').map(g => g.feedback_text)),
  format: unique(guardrails.filter(g => g.feedback_type === 'format').map(g => g.feedback_text)),
  legal: unique(boundaries ?? []),
})

const renderTemplate = (template: string | null | undefined, map: Record<string, string>) => {
  if (!template) return ''
  return template.replace(/\{(\w+)\}/g, (_, key: string) => map[key] ?? '')
}

async function getAIPlatformPrompt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  platform: string,
  contentType: string,
) {
  const { data: specific } = await supabase
    .from('ai_platform_prompts')
    .select('*')
    .eq('platform', platform)
    .eq('content_type', contentType)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle<AiPromptRow>()

  if (specific) return specific

  const { data: general } = await supabase
    .from('ai_platform_prompts')
    .select('*')
    .eq('platform', 'general')
    .eq('content_type', contentType)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle<AiPromptRow>()

  return general ?? null
}

function timingOffset(id: string): { days?: number; hours?: number } {
  const timing = POST_TIMINGS.find((entry) => entry.id === id)
  return timing ? { days: timing.days ?? 0, hours: timing.hours } : {}
}

function addOffset(baseIso: string, off?: { days?: number; hours?: number }) {
  const d = new Date(baseIso)
  if (off?.days) d.setDate(d.getDate() + off.days)
  if (off?.hours) d.setHours(d.getHours() + (off.hours || 0))
  return d.toISOString()
}

const DEFAULT_PUBLISH_HOUR = 7
const DEFAULT_PUBLISH_MINUTE = 0
const DEFAULT_TIME_ZONE = 'Europe/London'

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts = dtf.formatToParts(date)
  const data: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      data[part.type] = Number.parseInt(part.value, 10)
    }
  }

  const tzTime = Date.UTC(
    data.year ?? date.getUTCFullYear(),
    (data.month ?? date.getUTCMonth() + 1) - 1,
    data.day ?? date.getUTCDate(),
    data.hour ?? date.getUTCHours(),
    data.minute ?? date.getUTCMinutes(),
    data.second ?? date.getUTCSeconds(),
  )

  return tzTime - date.getTime()
}

function applyDefaultPublishTime(baseIso: string) {
  const baseDate = new Date(baseIso)
  if (Number.isNaN(baseDate.getTime())) return baseIso

  const ymdParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(baseDate)

  const year = Number.parseInt(ymdParts.find((p) => p.type === 'year')?.value ?? '', 10)
  const month = Number.parseInt(ymdParts.find((p) => p.type === 'month')?.value ?? '', 10)
  const day = Number.parseInt(ymdParts.find((p) => p.type === 'day')?.value ?? '', 10)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return baseIso
  }

  const candidateUtc = Date.UTC(year, month - 1, day, DEFAULT_PUBLISH_HOUR, DEFAULT_PUBLISH_MINUTE, 0, 0)
  const candidateDate = new Date(candidateUtc)
  const offset = getTimeZoneOffsetMs(candidateDate, DEFAULT_TIME_ZONE)
  const finalDate = new Date(candidateUtc - offset)

  return finalDate.toISOString()
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
  const resolvedParams = await params
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient()
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
    } catch (error) {
      reqLogger.warn('generate-batch: tenant hydration step failed', { error: error instanceof Error ? error : new Error(String(error)) })
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid batch generate payload', parsed.error.format(), request)
    }
    const { platforms, selectedTimings, customDates } = parsed.data

    // Load campaign + tenant context
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, tenant_id, name, campaign_type, event_date, description, primary_cta, hero_image:media_assets!campaigns_hero_image_id_fkey(file_url), selected_timings, custom_dates')
      .eq('id', resolvedParams.id)
      .single<CampaignRecord>()
    if (!campaign) {
      reqLogger.warn('generate-batch campaign not found', { campaignId: resolvedParams.id })
      return notFound('Campaign not found', undefined, request)
    }

    const tenantId = campaign.tenant_id
    const eventDate = campaign.event_date
    const eventDateIso = typeof eventDate === 'string' ? eventDate : ''
    if (!tenantId) return badRequest('invalid_campaign', 'Campaign missing tenant', undefined, request)

    // Determine target platforms
    let targetPlatforms = Array.isArray(platforms) && platforms.length > 0
      ? [...new Set(platforms.map(p => p === 'instagram' ? 'instagram_business' : p))]
      : []
    if (targetPlatforms.length === 0) {
      const { data: conns } = await supabase
        .from('social_connections')
        .select('platform')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .returns<SocialConnectionRow[]>()
      const all = (conns ?? []).map((connection: SocialConnectionRow) => connection.platform)
      targetPlatforms = [...new Set(all
        .map((platform) => (platform === 'instagram' ? 'instagram_business' : platform))
        .filter((platform): platform is string => Boolean(platform))
      )]
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
    type Work = { platform: string; post_timing: TimingKey; scheduled_for: string }
    const items: Work[] = []
    for (const t of tSel) {
      if (!eventDate) continue; // tolerate missing event date when only custom dates are in use
      const off = timingOffset(t)
      const sIso = applyDefaultPublishTime(addOffset(eventDate, off))
      const workItems = targetPlatforms.map<Work>((p) => ({
        platform: p,
        post_timing: t as TimingKey,
        scheduled_for: sIso,
      }))
      items.push(...workItems)
    }
    for (const d of cDates) {
      const sIso = new Date(d).toISOString()
      const customItems = targetPlatforms.map<Work>((p) => ({
        platform: p,
        post_timing: 'custom',
        scheduled_for: sIso,
      }))
      items.push(...customItems)
    }
    reqLogger.info('generate-batch: work items computed', { campaignId: campaign.id, items: items.length, platforms: targetPlatforms.length, timings: tSel.length, customDates: cDates.length })

    // Generate + upsert per item
    const { data: brandProfile } = await supabase
      .from('brand_profiles')
      .select(`
        business_name,
        business_type,
        target_audience,
        brand_identity,
        brand_voice,
        tone_attributes,
        booking_url,
        website_url,
        opening_hours,
        menu_food_url,
        menu_drink_url,
        serves_food,
        serves_drinks,
        content_boundaries,
        phone,
        phone_e164,
        whatsapp,
        whatsapp_e164
      `)
      .eq('tenant_id', tenantId)
      .maybeSingle<BrandProfileRow>()

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle<{ name: string | null }>()

    if (!tenant) {
      return notFound('Tenant not found', undefined, request)
    }

    const { data: voiceProfile } = await supabase
      .from('brand_voice_profiles')
      .select('tone_attributes,characteristics,avg_sentence_length,emoji_usage,emoji_frequency')
      .eq('tenant_id', tenantId)
      .maybeSingle<BrandVoiceProfileRow>()

    const { data: guardrails } = await supabase
      .from('content_guardrails')
      .select('id,feedback_type,feedback_text')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('context_type.eq.campaign,context_type.eq.general')

    const { formatUkPhoneDisplay } = await import('@/lib/utils/format')
    const phoneRaw = brandProfile?.phone ?? brandProfile?.phone_e164 ?? null
    const whatsappRaw = brandProfile?.whatsapp ?? brandProfile?.whatsapp_e164 ?? null
    const formattedPhone = phoneRaw ? formatUkPhoneDisplay(phoneRaw) : null
    const formattedWhatsapp = whatsappRaw ? formatUkPhoneDisplay(whatsappRaw) : null

    const toneDescriptors = deriveToneDescriptors(voiceProfile, brandProfile, null)
    const brandVoiceSummary = buildBrandVoiceSummary(voiceProfile, brandProfile)
    const guardrailInstructions = mergeGuardrails(Array.isArray(guardrails) ? guardrails as GuardrailRow[] : [], brandProfile?.content_boundaries)

    const businessContext = {
      name: brandProfile?.business_name || tenant.name || 'The Venue',
      type: brandProfile?.business_type || 'hospitality venue',
      servesFood: Boolean(brandProfile?.serves_food),
      servesDrinks: Boolean(brandProfile?.serves_drinks ?? true),
      brandVoiceSummary,
      targetAudience: brandProfile?.target_audience,
      identityHighlights: brandProfile?.brand_identity,
      toneDescriptors,
      preferredLink: brandProfile?.booking_url || brandProfile?.website_url || null,
      secondaryLink: brandProfile?.booking_url && brandProfile?.website_url && brandProfile?.booking_url !== brandProfile?.website_url ? brandProfile?.website_url : null,
      phone: formattedPhone,
      whatsapp: formattedWhatsapp,
      openingHours: toOpeningHoursRecord(brandProfile?.opening_hours ?? null),
      menus: { food: brandProfile?.menu_food_url ?? null, drink: brandProfile?.menu_drink_url ?? null },
      contentBoundaries: brandProfile?.content_boundaries ?? null,
      additionalContext: null,
      avgSentenceLength: voiceProfile?.avg_sentence_length ?? null,
      emojiUsage: voiceProfile?.emoji_usage ?? null,
    }

    const campaignBrief = campaign.description ?? null
    const eventDateObj = eventDateIso ? new Date(eventDateIso) : null

    // Load posting schedules to set time-of-day per platform/day
    const scheduleMap: Record<string, Record<number, string>> = {}
    try {
      const { data: sched } = await supabase
        .from('posting_schedules')
        .select('platform, day_of_week, time, active')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .returns<PostingScheduleRow[]>()
      for (const row of sched ?? []) {
        const key = (row.platform === 'instagram_business' ? 'instagram' : row.platform) || 'facebook'
        const day = typeof row.day_of_week === 'number' ? row.day_of_week : Number(row.day_of_week)
        if (!Number.isFinite(day)) continue
        if (!scheduleMap[key]) scheduleMap[key] = {}
        if (typeof row.time === 'string') {
          scheduleMap[key][day] = row.time
        }
      }
      if (DEBUG) reqLogger.info('generate-batch: schedule map loaded', { platforms: Object.keys(scheduleMap) })
    } catch (error) {
      reqLogger.warn('generate-batch: schedule load failed', { error: error instanceof Error ? error : new Error(String(error)) })
    }

    if (Array.isArray(guardrails) && guardrails.length > 0) {
      const guardrailIds = (guardrails as GuardrailRow[]).map(g => g.id)
      const { error: guardrailError } = await supabase.rpc('increment_guardrails_usage', { guardrail_ids: guardrailIds })
      if (guardrailError) {
        reqLogger.warn('generate-batch: guardrail usage increment failed', {
          area: 'campaigns',
          op: 'increment-guardrails',
          status: 'fail',
          error: guardrailError,
        })
      }
    }

    const platformPromptCache = new Map<string, AiPromptRow | null>()
    const openai = getOpenAIClient()

    const results: ResultItem[] = []
    let fallbackCount = 0

    for (const w of items) {
      // Normalise platform for DB and compute the final scheduled time (posting schedule or 07:00 fallback)
      const dbPlatform = w.platform === 'instagram_business' ? 'instagram' : w.platform
      let scheduledFor = w.scheduled_for
      if (!scheduledFor) {
        reqLogger.warn('generate-batch: skipping entry without scheduled_for', {
          area: 'campaigns',
          op: 'generate-batch',
          status: 'skip',
          meta: { platform: w.platform, postTiming: w.post_timing }
        })
        continue
      }
      try {
        const now = new Date()
        const schBase = new Date(scheduledFor)
        // Apply posting schedule time if available
        const dow = schBase.getDay() // 0=Sun..6=Sat
        const preferred = scheduleMap[dbPlatform]?.[dow]
        const setLocalTime = (iso: string, hhmm: string) => {
          const d = new Date(iso)
          const [hhRaw, mmRaw] = hhmm.split(':')
          const hh = Number.parseInt(hhRaw, 10)
          const mm = Number.parseInt(mmRaw ?? '0', 10)
          d.setHours(Number.isFinite(hh) ? hh : 7, Number.isFinite(mm) ? mm : 0, 0, 0)
          return d.toISOString()
        }
        if (typeof preferred === 'string' && preferred.length > 0) {
          scheduledFor = setLocalTime(scheduledFor, preferred)
        } else {
          // Default to 07:00 local if time is midnight
          const atMidnight = schBase.getHours() === 0 && schBase.getMinutes() === 0
          if (atMidnight) {
            const d = new Date(scheduledFor)
            d.setHours(7, 0, 0, 0)
            scheduledFor = d.toISOString()
          }
        }
        // If scheduled earlier today than now, bump by 1 hour from now
        const sameDay = schBase.toISOString().slice(0,10) === now.toISOString().slice(0,10)
        const schAfterAdjust = new Date(scheduledFor)
        if (sameDay && schAfterAdjust.getTime() < now.getTime()) {
          const bump = new Date(now)
          bump.setMinutes(0,0,0)
          bump.setHours(bump.getHours() + 1)
          scheduledFor = bump.toISOString()
        }
        if (DEBUG) reqLogger.info('generate-batch: scheduled time computed', { dbPlatform, postTiming: w.post_timing, scheduledFor })
      } catch {}

      if (DEBUG) reqLogger.info('generate-batch: item start', { platform: w.platform, postTiming: w.post_timing, scheduledFor })
      // Do not skip past dates — always create the row as draft so the user can adjust time

      // Idempotency: check existing row using final scheduledFor
      const { data: existing } = await supabase
        .from('campaign_posts')
        .select('id, content')
        .eq('campaign_id', campaign.id)
        .eq('platform', dbPlatform)
        .eq('post_timing', w.post_timing)
        .eq('scheduled_for', scheduledFor)
        .maybeSingle()

      const platformPrompt = await (async () => {
        if (platformPromptCache.has(w.platform)) return platformPromptCache.get(w.platform) ?? null
        const promptRow = await getAIPlatformPrompt(supabase, w.platform, 'post')
        platformPromptCache.set(w.platform, promptRow)
        return promptRow
      })()

      const scheduledDateObj = new Date(scheduledFor)

      const structuredPrompt = buildStructuredPostPrompt({
        business: businessContext,
        campaign: {
          name: campaign.name ?? 'Campaign',
          type: campaign.campaign_type || 'General promotion',
          variant: campaign.campaign_type || null,
          platform: w.platform,
          objective: campaignBrief || 'Drive attendance and awareness.',
          eventDate: eventDateObj,
          scheduledDate: scheduledDateObj,
          relativeTiming: getRelativeTimingLabel(eventDateObj, scheduledDateObj),
          toneAttributes: toneDescriptors,
          creativeBrief: campaignBrief,
          additionalContext: null,
          includeHashtags: false,
          includeEmojis: voiceProfile?.emoji_usage !== false,
          maxLength: null,
          callToAction: campaign.primary_cta ?? null,
        },
        guardrails: guardrailInstructions,
        options: { paragraphCount: 2, ctaOptions: defaultCtasForPlatform(w.platform) },
      })

      const eventDateLabel = eventDateObj
        ? formatDate(eventDateObj, 'Europe/London', { weekday: 'long', day: 'numeric', month: 'long' })
        : ''
      const eventDayLabel = eventDateObj
        ? formatDate(eventDateObj, 'Europe/London', { weekday: 'long' })
        : ''
      const eventTimeLabel = eventDateObj
        ? formatTime(eventDateObj, 'Europe/London').replace(/:00(?=[ap]m$)/, '')
        : ''

      const relativeHint = structuredPrompt.relativeTiming
        || getRelativeTimingLabel(eventDateObj, scheduledDateObj)
        || relativeLabel(w.scheduled_for ?? scheduledFor, eventDateIso || scheduledFor)

      const templateData: Record<string, string> = {
        businessName: businessContext.name,
        businessType: businessContext.type,
        targetAudience: businessContext.targetAudience ?? '',
        preferredLink: businessContext.preferredLink ?? '',
        websiteUrl: brandProfile?.website_url ?? '',
        bookingUrl: brandProfile?.booking_url ?? '',
        phone: businessContext.phone ?? '',
        whatsapp: businessContext.whatsapp ?? '',
        campaignName: campaign.name ?? 'Campaign',
        campaignType: campaign.campaign_type || 'General promotion',
        platform: w.platform,
        eventDate: eventDateLabel,
        eventDay: eventDayLabel,
        eventTime: eventTimeLabel,
        relativeTiming: relativeHint ?? '',
        tone: (toneDescriptors ?? []).join(', '),
        toneAttributes: (toneDescriptors ?? []).join(', '),
        creativeBrief: campaignBrief ?? '',
        additionalContext: campaignBrief ?? '',
        objective: campaignBrief ?? '',
        callToAction: campaign.primary_cta ?? '',
      }

      let systemPrompt = structuredPrompt.systemPrompt
      let userPrompt = structuredPrompt.userPrompt

      if (platformPrompt) {
        const renderedSystem = renderTemplate(platformPrompt.system_prompt, templateData)
        const renderedUser = renderTemplate(platformPrompt.user_prompt_template, templateData)
        if (renderedSystem.trim()) {
          systemPrompt = [systemPrompt, 'CUSTOM SYSTEM INSTRUCTIONS:', renderedSystem].join('\n\n')
        }
        if (renderedUser.trim()) {
          userPrompt = [userPrompt, '', 'CUSTOM USER INSTRUCTIONS:', renderedUser].join('\n')
        }
      }

      let content = ''
      let usedFallback = false
      try {
        const completion = await withRetry(async () => {
          return await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.8,
            max_tokens: 500,
          })
        }, PLATFORM_RETRY_CONFIGS.openai)
        content = completion.choices[0]?.message?.content || ''
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        reqLogger.warn('generate-batch: OpenAI generation failed, using fallback copy', {
          area: 'campaigns',
          op: 'generate-batch',
          status: 'warn',
          error: err,
          meta: { platform: w.platform, postTiming: w.post_timing },
        })
        // Fallback: simple two-paragraph copy with relative wording
        const rel = relativeLabel(w.scheduled_for ?? scheduledFor, eventDateIso || scheduledFor)
        const whenText = rel === 'today' ? 'tonight' : (rel === 'tomorrow' ? 'tomorrow night' : rel)
        const venueName = brandProfile?.business_name ?? 'the pub'
        if (String(campaign.campaign_type || '').toLowerCase().includes('offer')) {
          const endText = rel ? `Offer ends ${rel}.` : 'Limited-time offer.'
          content = `Don’t miss our Manager’s Special — a limited-time offer at ${venueName}. Enjoy a warm welcome and great vibes.\n\n${endText}`
        } else {
          content = `Join us ${whenText} at ${venueName}! Expect great vibes, friendly faces and a brilliant atmosphere.\n\nWe’ve got something special lined up — come early for food and get comfy. See you there!`
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
        scheduledFor,
        relativeTiming: structuredPrompt.relativeTiming ?? relativeHint,
        brand: { booking_url: brandProfile?.booking_url ?? null, website_url: brandProfile?.website_url ?? null },
        voiceBaton: structuredPrompt.voiceBaton ?? null,
        explicitDate: structuredPrompt.explicitDate ?? null,
      })
      content = processed.content

      const row = {
        campaign_id: campaign.id,
        post_timing: w.post_timing,
        content,
        scheduled_for: scheduledFor,
        platform: dbPlatform,
        status: 'draft' as const,
        // Start all generated posts in the approval workflow as 'pending'
        approval_status: 'pending' as const,
        media_url: campaign.hero_image?.file_url ?? null,
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

    const tally = results.reduce<Record<ResultStatus, number>>((acc, item) => {
      acc[item.status] += 1
      return acc
    }, { created: 0, updated: 0, failed: 0 })
    const responsePayload = { ...tally, skipped: 0, items: results, fallbackCount }
    reqLogger.apiResponse('POST', `/api/campaigns/${resolvedParams.id}/generate-batch`, 200, 0, { area: 'campaigns', op: 'generate-batch', status: 'ok', ...responsePayload })
    return ok(responsePayload, request)
  } catch (error) {
    reqLogger.error('generate-batch: unhandled error', { area: 'campaigns', op: 'generate-batch', error: error instanceof Error ? error : new Error(String(error)) })
    const err = error instanceof Error ? error : new Error(String(error))
    return serverError('Failed to batch-generate posts', { message: err.message }, request)
  }
}
