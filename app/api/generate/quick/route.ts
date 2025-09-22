import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIClient } from '@/lib/openai/client'
import {
  buildStructuredPostPrompt,
  buildBrandVoiceSummary,
  defaultCtasForPlatform,
  deriveToneDescriptors,
  getRelativeTimingLabel,
} from '@/lib/openai/prompts'
import { quickGenerateSchema } from '@/lib/validation/schemas'
import { preflight } from '@/lib/preflight'
import { enforcePlatformLimits } from '@/lib/utils/text'
import { unauthorized, badRequest, ok, serverError, rateLimited, notFound } from '@/lib/http'
import { enforceUserAndTenantLimits } from '@/lib/rate-limit'
import { checkTenantBudget, incrementUsage } from '@/lib/usage'
import { safeLog } from '@/lib/scrub'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

const DEFAULT_PLATFORMS = ['facebook']
const DAILY_RELATIVE_LABEL = 'today'

type QuickGeneratePayload = z.infer<typeof quickGenerateSchema> & { platforms?: string[] }

type OpeningHoursDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type OpeningHours = (Partial<Record<OpeningHoursDayKey, { open?: string | null; close?: string | null; closed?: boolean | null }>> & {
  exceptions?: Array<{ date?: string | null; open?: string | null; close?: string | null; closed?: boolean | null; note?: string | null }>
}) | null

type BrandProfile = {
  business_name: string | null
  business_type: string | null
  brand_identity: string | null
  brand_voice: string | null
  tone_attributes: string[] | null
  website_url?: string | null
  booking_url?: string | null
  opening_hours?: OpeningHours
  phone?: string | null
  phone_e164?: string | null
  whatsapp?: string | null
  whatsapp_e164?: string | null
  menu_food_url?: string | null
  menu_drink_url?: string | null
  serves_food?: boolean | null
  serves_drinks?: boolean | null
  content_boundaries?: string[] | null
}

type BrandVoiceProfile = {
  tone_attributes?: string[] | null
  characteristics?: string[] | null
  avg_sentence_length?: number | null
  emoji_usage?: boolean | null
  emoji_frequency?: string | null
  hashtag_style?: string | null
}

type GuardrailRow = {
  id: string
  feedback_type: 'avoid' | 'include' | 'tone' | 'style' | 'format'
  feedback_text: string
}

type TenantWithName = { name: string | null }

type UserTenantData = {
  tenant_id: string | null
  tenant: TenantWithName | TenantWithName[] | null
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

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)

  try {
    if (!process.env.OPENAI_API_KEY) {
      return badRequest('openai_not_configured', 'AI text generation is not configured on this server. Please set OPENAI_API_KEY.', request)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    const rawPayload = await request.json().catch(() => ({}))
    const schema = z.object(quickGenerateSchema.shape).extend({ platforms: z.array(z.string()).optional() })
    const parsed = schema.safeParse(rawPayload)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid quick generate payload', parsed.error.format(), request)
    }

    const { prompt, tone, platforms } = parsed.data as QuickGeneratePayload

    const { data: userRecord } = await supabase
      .from('users')
      .select(`
        tenant_id,
        tenant:tenants ( name )
      `)
      .eq('id', user.id)
      .single<UserTenantData>()

    const tenantId = userRecord?.tenant_id
    if (!tenantId) return notFound('No tenant found', undefined, request)

    const { user: userLimit, tenant: tenantLimit } = await enforceUserAndTenantLimits({
      userId: user.id,
      tenantId,
      userLimit: { requests: 10, window: '5 m' },
      tenantLimit: { requests: 50, window: '5 m' },
    })
    const now = Date.now()
    if ([userLimit, tenantLimit].filter(Boolean).some(limit => limit && !limit.success)) {
      const soonestReset = Math.min(...[userLimit, tenantLimit].filter(Boolean).map(l => l!.reset))
      const retryAfter = Math.max(0, Math.ceil((soonestReset - now) / 1000))
      return rateLimited('AI generation rate limit exceeded', retryAfter, { scope: 'ai_quick_generate' }, request)
    }

    const { data: brandProfile } = await supabase
      .from('brand_profiles')
      .select(`
        business_name,
        business_type,
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

    if (!brandProfile) return notFound('No brand profile found', undefined, request)

    const { data: voiceProfile } = await supabase
      .from('brand_voice_profiles')
      .select('tone_attributes,characteristics,avg_sentence_length,emoji_usage,emoji_frequency,hashtag_style')
      .eq('tenant_id', tenantId)
      .maybeSingle<BrandVoiceProfile>()

    const { data: guardrails } = await supabase
      .from('content_guardrails')
      .select('id,feedback_type,feedback_text')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('context_type.eq.quick_post,context_type.eq.general')

    const tenantName = Array.isArray(userRecord?.tenant)
      ? userRecord?.tenant?.[0]?.name
      : (userRecord?.tenant as TenantWithName | null)?.name

    const { formatUkPhoneDisplay } = await import('@/lib/utils/format')
    const phoneRaw = brandProfile.phone ?? brandProfile.phone_e164 ?? null
    const whatsappRaw = brandProfile.whatsapp ?? brandProfile.whatsapp_e164 ?? null
    const formattedPhone = phoneRaw ? formatUkPhoneDisplay(phoneRaw) : null
    const formattedWhatsapp = whatsappRaw ? formatUkPhoneDisplay(whatsappRaw) : null

    const toneDescriptors = deriveToneDescriptors(voiceProfile, brandProfile, tone ?? null)
    const brandVoiceSummary = buildBrandVoiceSummary(voiceProfile, brandProfile)
    const guardrailInstructions = mergeGuardrails(Array.isArray(guardrails) ? guardrails as GuardrailRow[] : [], brandProfile.content_boundaries)

    const business = {
      name: brandProfile.business_name || tenantName || 'The Venue',
      type: brandProfile.business_type || 'hospitality venue',
      servesFood: Boolean(brandProfile.serves_food),
      servesDrinks: Boolean(brandProfile.serves_drinks ?? true),
      brandVoiceSummary,
      targetAudience: brandProfile.target_audience,
      identityHighlights: brandProfile.brand_identity,
      toneDescriptors,
      preferredLink: brandProfile.booking_url || brandProfile.website_url || null,
      secondaryLink: brandProfile.booking_url && brandProfile.website_url && brandProfile.booking_url !== brandProfile.website_url ? brandProfile.website_url : null,
      phone: formattedPhone,
      whatsapp: formattedWhatsapp,
      openingHours: brandProfile.opening_hours ?? null,
      menus: { food: brandProfile.menu_food_url, drink: brandProfile.menu_drink_url },
      contentBoundaries: brandProfile.content_boundaries ?? null,
      additionalContext: null,
    }

    const platformsToUse = (Array.isArray(platforms) && platforms.length ? platforms : DEFAULT_PLATFORMS)
      .filter(p => p !== 'twitter')
      .map(p => p || 'facebook')

    const estTokens = 300 * platformsToUse.length
    const budget = await checkTenantBudget(tenantId, estTokens)
    if (!budget.ok) {
      return NextResponse.json({ ok: false, error: { code: 'BUDGET_EXCEEDED', message: 'Your monthly AI budget has been exceeded.' } }, { status: 402 })
    }

    if (Array.isArray(guardrails) && guardrails.length > 0) {
      const guardrailIds = (guardrails as GuardrailRow[]).map(g => g.id)
      const { error: guardrailError } = await supabase.rpc('increment_guardrails_usage', { guardrail_ids: guardrailIds })
      if (guardrailError) {
        reqLogger.warn('generate-quick: guardrail usage increment failed', {
          area: 'ai',
          op: 'increment-guardrails',
          status: 'fail',
          error: guardrailError,
        })
      }
    }

    const openai = getOpenAIClient()
    const contents: Record<string, string> = {}

    const nowDate = new Date()
    const relativeTiming = getRelativeTimingLabel(nowDate, nowDate) ?? DAILY_RELATIVE_LABEL

    for (const platformKey of platformsToUse) {
      const campaign = {
        name: 'Daily update',
        type: 'Daily update',
        platform: platformKey,
        objective: prompt || 'Drive footfall and highlight today\'s experience.',
        eventDate: null,
        scheduledDate: nowDate,
        relativeTiming,
        toneAttributes: toneDescriptors,
        creativeBrief: prompt || null,
        additionalContext: prompt || null,
        includeHashtags: false,
        includeEmojis: voiceProfile?.emoji_usage !== false,
        maxLength: platformKey === 'linkedin' ? 700 : null,
      }

      const promptOptions = {
        paragraphCount: 2,
        ctaOptions: defaultCtasForPlatform(platformKey),
      }

      const structured = buildStructuredPostPrompt({
        business,
        campaign,
        guardrails: guardrailInstructions,
        options: promptOptions,
      })

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: structured.systemPrompt },
          { role: 'user', content: structured.userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 220,
      })

      let text = completion.choices[0]?.message?.content || ''
      try {
        const { postProcessContent } = await import('@/lib/openai/post-processor')
        text = postProcessContent({
          content: text,
          platform: platformKey,
          brand: { booking_url: brandProfile.booking_url ?? null, website_url: brandProfile.website_url ?? null },
        }).content
      } catch (error) {
        text = enforcePlatformLimits(text, platformKey)
        const findings = preflight(text, platformKey)
        if (platformKey === 'twitter' && findings.some(f => f.code === 'length_twitter')) {
          text = enforcePlatformLimits(text, 'twitter')
        }
      }

      contents[platformKey] = text
    }

    try {
      await incrementUsage(tenantId, { tokens: estTokens, requests: 1 })
    } catch (error) {
      reqLogger.warn('generate-quick: usage increment failed', { error: error instanceof Error ? error : new Error(String(error)) })
    }

    return ok({ contents }, request)
  } catch (error) {
    safeLog('Quick post generation error', error)
    return serverError('Failed to generate content', undefined, request)
  }
}
