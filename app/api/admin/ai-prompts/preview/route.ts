import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { generatePostPrompt } from '@/lib/openai/prompts'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    // Superadmin or allowlisted email
    const { data: u } = await supabase
      .from('users')
      .select('is_superadmin, email')
      .eq('id', user.id)
      .single()
    const emailOk = ((u?.email || user.email || '').toLowerCase() === 'peter.pitcher@outlook.com')
    if (!u?.is_superadmin && !emailOk) return forbidden('Forbidden', undefined, request)

    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const platform = (searchParams.get('platform') || 'facebook') as string

    if (!campaignId) return badRequest('validation_error', 'Missing campaignId', undefined, request)

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, name, campaign_type, event_date, tenant_id')
      .eq('id', campaignId)
      .single()
    if (!campaign) return notFound('Campaign not found', undefined, request)

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
      eventDate: new Date(campaign.event_date as any),
      postTiming: 'custom',
      toneAttributes: ['friendly','welcoming'],
      businessType: brand?.business_type || 'pub',
      targetAudience: brand?.target_audience || 'local community',
      platform: platform as any,
      customDate: new Date(campaign.event_date as any)
    })

    return ok({ system: systemPrompt, user: userPrompt }, request)
  } catch (e) {
    return serverError('Failed to render prompt preview', undefined, request)
  }
}

