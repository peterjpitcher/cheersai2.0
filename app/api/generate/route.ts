import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatTime } from '@/lib/datetime'
import { getOpenAIClient } from '@/lib/openai/client'
import { buildBrandVoiceSummary, computeScheduledDate, deriveToneDescriptors, getRelativeTimingLabel, toOpeningHoursRecord, type TimingKey } from '@/lib/openai/prompts'
import { createPostInput, buildGuardrailAppend } from '@/lib/openai/post-input'
import { generateCompliantPost } from '@/lib/openai/compliance'
import { z } from 'zod'
import type { DatabaseWithoutInternals } from '@/lib/database.types'
import { generateContentSchema } from '@/lib/validation/schemas'
import { unauthorized, notFound, ok, serverError, rateLimited, badRequest } from '@/lib/http'
import { enforceUserAndTenantLimits } from '@/lib/rate-limit'
import { checkTenantBudget, incrementUsage } from '@/lib/usage'
import { createRequestLogger } from '@/lib/observability/logger'
import { safeLog } from '@/lib/scrub'
import { withRetry, PLATFORM_RETRY_CONFIGS } from '@/lib/reliability/retry'

export const runtime = 'nodejs'

type AiPromptRow = DatabaseWithoutInternals['public']['Tables']['ai_platform_prompts']['Row']

const DEFAULT_PLATFORM = 'facebook'

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

type BrandProfile = DatabaseWithoutInternals['public']['Tables']['brand_profiles']['Row'] | null

type BrandVoiceProfile = DatabaseWithoutInternals['public']['Tables']['brand_voice_profiles']['Row'] | null

type GuardrailRow = DatabaseWithoutInternals['public']['Tables']['content_guardrails']['Row']

type CampaignRow = Pick<DatabaseWithoutInternals['public']['Tables']['campaigns']['Row'], 'id' | 'name' | 'campaign_type' | 'event_date' | 'description' | 'primary_cta'>

type GenerateRequestPayload = {
  campaignId?: string
  postTiming?: TimingKey | 'custom'
  campaignType?: string
  campaignName?: string
  eventDate?: string
  platform?: string
  businessContext?: string
  tone?: string
  includeEmojis?: boolean
  includeHashtags?: boolean
  customDate?: string
  prompt?: string
  maxLength?: number
  callToAction?: string
}

const unique = (values: Array<string | null | undefined>) => {
  const set = new Set<string>()
  for (const value of values) {
    if (!value) continue
    const cleaned = value.replace(/\s+/g, ' ').trim()
    if (cleaned) set.add(cleaned)
  }
  return Array.from(set)
}

const mergeGuardrails = (guardrails: GuardrailRow[], brandBoundaries?: string[] | null) => {
  const mustInclude = guardrails.filter(g => g.feedback_type === 'include').map(g => g.feedback_text)
  const mustAvoid = guardrails.filter(g => g.feedback_type === 'avoid').map(g => g.feedback_text)
  const tone = guardrails.filter(g => g.feedback_type === 'tone').map(g => g.feedback_text)
  const style = guardrails.filter(g => g.feedback_type === 'style').map(g => g.feedback_text)
  const format = guardrails.filter(g => g.feedback_type === 'format').map(g => g.feedback_text)

  const legal = brandBoundaries ?? []

  return {
    mustInclude: unique(mustInclude),
    mustAvoid: unique([...mustAvoid, ...(legal ?? [])]),
    tone: unique(tone),
    style: unique(style),
    format: unique(format),
    legal: unique(legal ?? []),
  }
}

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)

  try {
    const supabase = await createClient()
    reqLogger.apiRequest('POST', '/api/generate', { area: 'ai', op: 'generate' })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

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
          reqLogger.info('generate: hydrated users.tenant_id from membership', { tenantId: membership.tenant_id })
        }
      }
    } catch (error) {
      reqLogger.warn('generate: tenant hydration step failed', { error: error instanceof Error ? error : new Error(String(error)) })
    }

    const rawPayload = await request.json().catch(() => ({}))
    const parsed = z.object(generateContentSchema.shape).partial().safeParse(rawPayload)
    if (!parsed.success) reqLogger.warn('generate: payload validation failed', { details: parsed.error.format() })

    const {
      campaignId,
      postTiming,
      campaignType,
      campaignName,
      eventDate,
      platform,
      businessContext,
      tone,
      includeEmojis,
      includeHashtags,
      customDate,
      prompt,
      callToAction,
      maxLength,
    } = (parsed.success ? parsed.data : rawPayload) as GenerateRequestPayload

    const normalizedCallToAction = (() => {
      if (typeof callToAction !== 'string') return null
      const trimmed = callToAction.trim().slice(0, 200)
      return trimmed.length ? trimmed : null
    })()

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    const tenantId = userRow?.tenant_id
    if (!tenantId) return notFound('No tenant found', undefined, request)

    const devMode = process.env.NODE_ENV !== 'production'
    const { user: userLimit, tenant: tenantLimit } = await enforceUserAndTenantLimits({
      userId: user.id,
      tenantId,
      userLimit: devMode ? { requests: 100, window: '1 m' } : { requests: 10, window: '5 m' },
      tenantLimit: devMode ? { requests: 300, window: '1 m' } : { requests: 50, window: '5 m' },
    })
    const now = Date.now()
    const blocked = [userLimit, tenantLimit].filter(Boolean).some(l => l && !l.success)
    if (blocked) {
      const soonestReset = Math.min(...[userLimit, tenantLimit].filter(Boolean).map(l => l!.reset))
      const retryAfter = Math.max(0, Math.ceil((soonestReset - now) / 1000))
      return rateLimited('AI generation rate limit exceeded', retryAfter, { scope: 'ai_campaign_generate' }, request)
    }

    const estTokens = 500
    const budget = await checkTenantBudget(tenantId, estTokens)
    if (!budget.ok) {
      reqLogger.event('warn', { area: 'ai', op: 'budget', status: 'fail', tenantId, errorCode: 'BUDGET_EXCEEDED', msg: budget.message })
      return NextResponse.json({ ok: false, error: { code: 'BUDGET_EXCEEDED', message: 'Your monthly AI budget has been exceeded. Please upgrade your plan.' } }, { status: 402 })
    }

    const { data: brandProfile } = await supabase
      .from('brand_profiles')
      .select(`
        business_name,
        business_type,
        target_audience,
        brand_identity,
        brand_voice,
        tone_attributes,
        website_url,
        booking_url,
        opening_hours,
        phone,
        phone_e164,
        whatsapp,
        whatsapp_e164,
        menu_food_url,
        menu_drink_url,
        serves_food,
        serves_drinks,
        content_boundaries
      `)
      .eq('tenant_id', tenantId)
      .maybeSingle<BrandProfile>()

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single()

    if (!tenant) return notFound('No tenant found', undefined, request)

    const { data: voiceProfile } = await supabase
      .from('brand_voice_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle<BrandVoiceProfile>()

    const { data: guardrails } = await supabase
      .from('content_guardrails')
      .select('id,feedback_type,feedback_text')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('context_type.eq.campaign,context_type.eq.general')

    let campaignBrief: string | null = null
    let campaignCallToAction: string | null = null
    let fetchedCampaignRow: { description: string | null; primary_cta: string | null } | null = null
    if (campaignId) {
      const { data } = await supabase
        .from('campaigns')
        .select('description, primary_cta')
        .eq('id', campaignId)
        .maybeSingle<{ description: string | null; primary_cta: string | null }>()
      fetchedCampaignRow = data ?? null
      campaignBrief = fetchedCampaignRow?.description ?? null
      campaignCallToAction = fetchedCampaignRow?.primary_cta ?? null
    }

    const eventDateObj = eventDate ? new Date(eventDate) : null
    const customDateObj = customDate ? new Date(customDate) : null
    const scheduledDate = computeScheduledDate(eventDateObj, postTiming ?? undefined, customDateObj)
    const relativeTiming = getRelativeTimingLabel(eventDateObj, scheduledDate)

    const { formatUkPhoneDisplay } = await import('@/lib/utils/format')
    const phoneRaw = brandProfile?.phone ?? brandProfile?.phone_e164 ?? null
    const whatsappRaw = brandProfile?.whatsapp ?? brandProfile?.whatsapp_e164 ?? null
    const formattedPhone = phoneRaw ? formatUkPhoneDisplay(phoneRaw) : null
    const formattedWhatsapp = whatsappRaw ? formatUkPhoneDisplay(whatsappRaw) : null

    const toneDescriptors = deriveToneDescriptors(voiceProfile, brandProfile, tone ?? null)
    const brandVoiceSummary = buildBrandVoiceSummary(voiceProfile, brandProfile)

    const business = {
      name: brandProfile?.business_name || tenant.name,
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
      additionalContext: businessContext || null,
      avgSentenceLength: voiceProfile?.avg_sentence_length ?? null,
      emojiUsage: voiceProfile?.emoji_usage ?? null,
    }

    const campaignObjective = businessContext
      || campaignBrief
      || (campaignId ? 'Drive awareness and attendance at the venue.' : null)
      || prompt
      || null

    const campaign = {
      name: campaignName || (campaignType ? `${campaignType} campaign` : 'Campaign announcement'),
      type: campaignType || 'General promotion',
      variant: campaignType || null,
      platform: platform || DEFAULT_PLATFORM,
      objective: campaignObjective,
      eventDate: eventDateObj,
      scheduledDate,
      relativeTiming,
      toneAttributes: toneDescriptors,
      creativeBrief: campaignBrief,
      additionalContext: prompt || null,
      includeHashtags: includeHashtags !== false,
      includeEmojis: includeEmojis !== false,
      maxLength: maxLength ?? null,
      callToAction: normalizedCallToAction ?? campaignCallToAction ?? null,
    }

    const guardrailInstructions = mergeGuardrails(Array.isArray(guardrails) ? guardrails as GuardrailRow[] : [], brandProfile?.content_boundaries)

    const campaignForInput: CampaignRow | null = campaignId
      ? {
          id: campaignId,
          name: campaign.name,
          campaign_type: campaign.type,
          event_date: eventDateObj?.toISOString() ?? null,
          description: campaign.creativeBrief ?? fetchedCampaignRow?.description ?? null,
          primary_cta: campaign.callToAction ?? fetchedCampaignRow?.primary_cta ?? null,
        }
      : null

    const postInput = createPostInput({
      brandProfile: brandProfile!,
      voiceProfile: voiceProfile ?? undefined,
      guardrails: guardrailInstructions,
      campaign: campaignForInput,
      platform: campaign.platform,
      eventDate: eventDateObj ?? undefined,
      relativeLabel: campaign.relativeTiming ?? undefined,
      promptText: campaign.creativeBrief ?? prompt ?? undefined,
      fallbackCallToAction: campaign.callToAction ?? undefined,
    })

    const platformPrompt = await getAIPlatformPrompt(supabase, campaign.platform, 'post')

    let appendSystem: string | undefined
    let appendUser: string | undefined = buildGuardrailAppend(guardrailInstructions)
    if (platformPrompt) {
      const templateData: Record<string, string> = {
        businessName: business.name,
        businessType: business.type,
        targetAudience: business.targetAudience ?? '',
        preferredLink: business.preferredLink ?? '',
        websiteUrl: brandProfile?.website_url ?? '',
        bookingUrl: brandProfile?.booking_url ?? '',
        campaignName: campaign.name,
        campaignType: campaign.type,
        platform: campaign.platform,
        eventDate: eventDateObj ? formatDate(eventDateObj, 'Europe/London', { weekday: 'long', day: 'numeric', month: 'long' }) : '',
        eventDay: eventDateObj ? formatDate(eventDateObj, 'Europe/London', { weekday: 'long' }) : '',
        eventTime: eventDateObj ? formatTime(eventDateObj, 'Europe/London').replace(/:00(?=[ap]m$)/, '') : '',
        relativeTiming: campaign.relativeTiming ?? '',
        creativeBrief: campaign.creativeBrief ?? '',
        objective: campaign.objective ?? '',
      }
      const renderedSystem = renderTemplate(platformPrompt.system_prompt, templateData)
      const renderedUser = renderTemplate(platformPrompt.user_prompt_template, templateData)
      appendSystem = renderedSystem.trim() || undefined
      appendUser = [appendUser, renderedUser.trim()].filter(Boolean).join('\n\n') || undefined
    }

    if (Array.isArray(guardrails) && guardrails.length > 0) {
      const guardrailIds = (guardrails as GuardrailRow[]).map(g => g.id)
      const { error: guardrailError } = await supabase.rpc('increment_guardrails_usage', { guardrail_ids: guardrailIds })
      if (guardrailError) {
        reqLogger.warn('generate: guardrail usage increment failed', {
          area: 'ai',
          op: 'increment-guardrails',
          status: 'fail',
          error: guardrailError,
        })
      }
    }

    const openai = getOpenAIClient()
    const generatedContent = await withRetry(
      () => generateCompliantPost(postInput, { openai, appendSystem, appendUser }),
      PLATFORM_RETRY_CONFIGS.openai,
    )

    if (generatedContent.startsWith('NEEDS-REVISION')) {
      return badRequest('needs_revision', generatedContent, request)
    }

    if (tenantId) {
      try {
        await incrementUsage(tenantId, { tokens: estTokens, requests: 1 })
      } catch (usageError) {
        reqLogger.warn('generate: usage increment failed', { error: usageError instanceof Error ? usageError : new Error(String(usageError)) })
      }
    }

    return ok({ content: generatedContent }, request)
  } catch (error) {
    safeLog('Generate route error', error)
    return serverError('Failed to generate content', undefined, request)
  }
}
