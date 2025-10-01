import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import {
  buildBrandVoiceSummary,
  buildStructuredPostPrompt,
  defaultCtasForPlatform,
  deriveToneDescriptors,
  getRelativeTimingLabel,
  toOpeningHoursRecord,
} from '@/lib/openai/prompts'
import { requireSuperadmin, SuperadminRequiredError } from '@/lib/security/superadmin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    try {
      await requireSuperadmin()
    } catch (error) {
      if (error instanceof SuperadminRequiredError) {
        if (error.reason === 'unauthenticated') return unauthorized('Authentication required', undefined, request)
        if (error.reason === 'forbidden') return forbidden('Forbidden', undefined, request)
      }
      throw error
    }

    const supabase = await createClient()

    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const platform = searchParams.get('platform') ?? 'facebook'

    if (!campaignId) return badRequest('validation_error', 'Missing campaignId', undefined, request)

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, name, campaign_type, event_date, tenant_id, primary_cta')
      .eq('id', campaignId)
      .single()
    if (!campaign) return notFound('Campaign not found', undefined, request)
    if (!campaign.event_date) {
      return badRequest('validation_error', 'Campaign missing event date', undefined, request)
    }

    const eventDate = new Date(campaign.event_date)
    if (Number.isNaN(eventDate.getTime())) {
      return badRequest('validation_error', 'Invalid campaign event date', undefined, request)
    }

    if (!campaign.tenant_id) {
      return badRequest('validation_error', 'Campaign missing tenant', undefined, request)
    }

    const { data: brand } = await supabase
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
      .eq('tenant_id', campaign.tenant_id)
      .maybeSingle()

    const { data: voiceProfile } = await supabase
      .from('brand_voice_profiles')
      .select('tone_attributes,characteristics,avg_sentence_length,emoji_usage,emoji_frequency')
      .eq('tenant_id', campaign.tenant_id)
      .maybeSingle()

    const { formatUkPhoneDisplay } = await import('@/lib/utils/format')
    const phoneRaw = brand?.phone ?? brand?.phone_e164 ?? null
    const whatsappRaw = brand?.whatsapp ?? brand?.whatsapp_e164 ?? null
    const formattedPhone = phoneRaw ? formatUkPhoneDisplay(phoneRaw) : null
    const formattedWhatsapp = whatsappRaw ? formatUkPhoneDisplay(whatsappRaw) : null

    const toneDescriptors = deriveToneDescriptors(voiceProfile, brand, null)
    const brandVoiceSummary = buildBrandVoiceSummary(voiceProfile, brand)

    const businessContext = {
      name: brand?.business_name || 'Our venue',
      type: brand?.business_type || 'hospitality venue',
      servesFood: Boolean(brand?.serves_food),
      servesDrinks: Boolean(brand?.serves_drinks ?? true),
      brandVoiceSummary,
      targetAudience: brand?.target_audience || null,
      identityHighlights: brand?.brand_identity || null,
      toneDescriptors,
      preferredLink: brand?.booking_url || brand?.website_url || null,
      secondaryLink: brand?.booking_url && brand?.website_url && brand?.booking_url !== brand?.website_url ? brand?.website_url : null,
      phone: formattedPhone,
      whatsapp: formattedWhatsapp,
      openingHours: toOpeningHoursRecord(brand?.opening_hours ?? null),
      menus: { food: brand?.menu_food_url ?? null, drink: brand?.menu_drink_url ?? null },
      contentBoundaries: brand?.content_boundaries ?? null,
      additionalContext: null,
      avgSentenceLength: voiceProfile?.avg_sentence_length ?? null,
      emojiUsage: voiceProfile?.emoji_usage ?? null,
    }

    const scheduledDate = eventDate
    const relativeTiming = getRelativeTimingLabel(eventDate, scheduledDate)

    const structured = buildStructuredPostPrompt({
      business: businessContext,
      campaign: {
        name: campaign.name ?? 'Campaign',
        type: campaign.campaign_type || 'General promotion',
        variant: campaign.campaign_type || null,
        platform,
        objective: 'Preview prompt for admin review.',
        eventDate,
        scheduledDate,
        relativeTiming,
        toneAttributes: toneDescriptors,
        creativeBrief: null,
        additionalContext: null,
        includeHashtags: false,
        includeEmojis: voiceProfile?.emoji_usage !== false,
        maxLength: null,
        callToAction: typeof campaign.primary_cta === 'string' ? campaign.primary_cta : null,
      },
      guardrails: undefined,
      options: { paragraphCount: 2, ctaOptions: defaultCtasForPlatform(platform) },
    })

    reqLogger.info('AI prompt preview generated', {
      area: 'admin',
      op: 'ai-prompts.preview',
      status: 'ok',
      meta: { campaignId, platform },
    })
    return ok({ system: structured.systemPrompt, user: structured.userPrompt }, request)
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to render prompt preview', {
      area: 'admin',
      op: 'ai-prompts.preview',
      status: 'fail',
      error: err,
    })
    logger.error('Failed to render prompt preview', {
      area: 'admin',
      op: 'ai-prompts.preview',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to render prompt preview', undefined, request)
  }
}
