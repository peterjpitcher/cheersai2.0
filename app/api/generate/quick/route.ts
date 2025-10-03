import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { DatabaseWithoutInternals } from '@/lib/database.types'
import { getOpenAIClient } from '@/lib/openai/client'
import { buildBrandVoiceSummary, getRelativeTimingLabel } from '@/lib/openai/prompts'
import { generateCompliantPost, type PostInput } from '@/lib/openai/compliance'
import { buildGuardrailAppend } from '@/lib/openai/post-input'
import { quickGenerateSchema } from '@/lib/validation/schemas'
import { unauthorized, badRequest, ok, serverError, rateLimited, notFound } from '@/lib/http'
import { enforceUserAndTenantLimits } from '@/lib/rate-limit'
import { checkTenantBudget, incrementUsage } from '@/lib/usage'
import { safeLog } from '@/lib/scrub'
import { createRequestLogger } from '@/lib/observability/logger'
import { withRetry, PLATFORM_RETRY_CONFIGS } from '@/lib/reliability/retry'

export const runtime = 'nodejs'

const DEFAULT_PLATFORMS = ['facebook']
const DAILY_RELATIVE_LABEL = 'today'

type QuickGeneratePayload = z.infer<typeof quickGenerateSchema> & { platforms?: string[] }

type BrandProfile = DatabaseWithoutInternals['public']['Tables']['brand_profiles']['Row']

type BrandVoiceProfile = DatabaseWithoutInternals['public']['Tables']['brand_voice_profiles']['Row'] | null

type GuardrailRow = DatabaseWithoutInternals['public']['Tables']['content_guardrails']['Row']

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

function deriveMicroIdentity(text?: string | null): string | undefined {
  if (!text) return undefined
  const words = text.split(/\s+/).slice(0, 8)
  if (!words.length) return undefined
  return words.join(' ')
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

    const { prompt, platforms } = parsed.data as QuickGeneratePayload

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

    const brandVoiceSummary = buildBrandVoiceSummary(voiceProfile, brandProfile)
    const guardrailInstructions = mergeGuardrails(Array.isArray(guardrails) ? guardrails as GuardrailRow[] : [], brandProfile.content_boundaries)

    const platformsToUse = (Array.isArray(platforms) && platforms.length ? platforms : DEFAULT_PLATFORMS)
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
    const guardrailAppend = buildGuardrailAppend(guardrailInstructions)
    const microIdentity = deriveMicroIdentity(brandProfile.brand_identity)
    const voiceDescriptor = brandVoiceSummary || 'Warm, polite, straight to the point; dry humour when it fits. No buzzwords.'
    const supportLink = brandProfile.website_url && brandProfile.website_url !== brandProfile.booking_url ? brandProfile.website_url : undefined

    for (const platformKey of platformsToUse) {
      const hasCatLink = Boolean(brandProfile.booking_url)
      const copyMode: PostInput['copyMode'] = platformKey === 'x' ? 'ultra' : 'single'
      const postInput: PostInput = {
        intent: 'informational',
        postType: 'community_note',
        platform: platformKey as PostInput['platform'],
        copyMode,
        brand: {
          voice: voiceDescriptor,
          microIdentity,
        },
        content: {
          what: prompt?.trim() || `Update from ${brandProfile.business_name ?? tenantName ?? 'our venue'}`,
          cta_text: hasCatLink ? 'Book now' : undefined,
          cta_link: brandProfile.booking_url ?? undefined,
          support_link: supportLink,
          relativeLabel: relativeTiming,
        },
        policies: {
          britishEnglish: true,
          allowHashtags: false,
          allowEmojis: false,
          allowLightHumour: true,
          timePolicy: { enforceLowercaseAmPm: true, enforceEnDashRanges: true },
          length: { maxWords: copyMode === 'ultra' ? 25 : 60, singleMaxSentences: 2, twoLineSentencesPerParagraph: 1 },
          linkPolicy: {
            supportLink: { required: false, maxCount: 1, notInFinalSentence: true },
            ctaLink: { required: hasCatLink, mustEndFinalSentence: hasCatLink },
          },
        },
      }

      const contextInstruction = prompt ? `CONTENT HINT:\n${prompt}` : undefined
      const appendUser = [guardrailAppend, contextInstruction].filter(Boolean).join('\n\n') || undefined

      const text = await withRetry(
        () => generateCompliantPost(postInput, { openai, appendUser }),
        PLATFORM_RETRY_CONFIGS.openai,
      )

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
