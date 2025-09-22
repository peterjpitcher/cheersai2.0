import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { generatePostPrompt } from '@/lib/openai/prompts'
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
      .select('id, name, campaign_type, event_date, tenant_id')
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
      .select('*')
      .eq('tenant_id', campaign.tenant_id)
      .maybeSingle()

    // Build a simple system prompt preview (keep it minimal and consistent)
    let systemPrompt = 'You are a UK hospitality social media expert. Use British English. Format as 2 short paragraphs separated by a single blank line. No markdown.'
    if (brand?.website_url) systemPrompt += `\nWebsite: ${brand.website_url}`
    if (brand?.booking_url) systemPrompt += `\nBooking: ${brand.booking_url}`

    const userPrompt = generatePostPrompt({
      campaignType: campaign.campaign_type,
      campaignName: campaign.name,
      businessName: brand?.business_name || 'Our pub',
      eventDate,
      postTiming: 'custom',
      toneAttributes: ['friendly', 'welcoming'],
      businessType: brand?.business_type || 'pub',
      targetAudience: brand?.target_audience || 'local community',
      platform,
      customDate: eventDate,
    })

    reqLogger.info('AI prompt preview generated', {
      area: 'admin',
      op: 'ai-prompts.preview',
      status: 'ok',
      meta: { campaignId, platform },
    })
    return ok({ system: systemPrompt, user: userPrompt }, request)
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
