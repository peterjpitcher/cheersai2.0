import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { createCampaignSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'
import { safeLog } from '@/lib/scrub'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const reqLogger = createRequestLogger(request as unknown as Request)
    reqLogger.apiRequest('POST', '/api/campaigns/create', { area: 'campaigns', op: 'create' })
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      reqLogger.warn('Unauthorized campaign create attempt')
      return unauthorized('Authentication required', undefined, request)
    }

    // Get user's tenant ID
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      reqLogger.warn('No tenant for user on campaign create', { userId: user.id })
      return notFound('No tenant found', undefined, request)
    }

    const tenantId = userData.tenant_id;
    const body = await request.json();
    reqLogger.debug?.('Create campaign payload received', { tenantId, len: JSON.stringify(body)?.length })
    const parsed = z.object(createCampaignSchema.shape).safeParse(body)
    if (!parsed.success) {
      reqLogger.warn('Campaign validation failed', { details: parsed.error.format() })
      return badRequest('validation_error', 'Invalid campaign payload', parsed.error.format(), request)
    }
    const input = parsed.data

    // Check subscription limits for campaign creation
    const { data: existingCampaigns } = await supabase
      .from('campaigns')
      .select('id')
      .eq('tenant_id', tenantId)
      .neq('status', 'completed');

    // Get subscription tier and limits
    const { data: tenant } = await supabase
      .from('tenants')
      .select('subscription_tier, subscription_status, total_campaigns_created')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      reqLogger.warn('Tenant record not found when creating campaign', { tenantId })
      return notFound('Tenant not found', undefined, request)
    }

    // Check trial limits first (10 campaigns total during trial)
    const isTrialing = tenant.subscription_status === 'trialing' || tenant.subscription_status === null;
    const campaignCount = tenant.total_campaigns_created || 0;
    
    if (isTrialing && campaignCount >= 10) {
      reqLogger.info('Trial limit reached on campaign create', { tenantId, campaignCount })
      return forbidden("You've reached the free trial limit of 10 campaigns. Please upgrade to continue creating campaigns.", { currentCount: campaignCount, limit: 10 }, request)
    }

    // Basic tier limits (can be moved to config) - monthly limits
    const campaignLimits: Record<string, number> = {
      'free': 10,
      'starter': 50,
      'professional': 200,
      'enterprise': 999999
    };

    const limit = campaignLimits[tenant.subscription_tier] || 10;
    
    if (!isTrialing && existingCampaigns && existingCampaigns.length >= limit) {
      reqLogger.info('Plan campaign limit reached', { tenantId, limit, existing: existingCampaigns.length, tier: tenant.subscription_tier })
      return forbidden(`Campaign limit reached. Your ${tenant.subscription_tier} plan allows ${limit} active campaigns.`, { currentCount: existingCampaigns.length, limit }, request)
    }

    // Normalize dates and scheduling fields
    const eventDate = input.event_date || input.startDate || null
    const selectedTimings = Array.isArray(input.selected_timings) ? input.selected_timings : []
    const customDates = Array.isArray(input.custom_dates) ? input.custom_dates : []

    // Create the campaign - log the data being inserted for debugging
    const campaignData = {
      tenant_id: tenantId,
      name: input.name,
      campaign_type: input.campaign_type,
      event_date: eventDate,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      description: input.description || null,
      hero_image_id: input.hero_image_id || null,
      status: input.status || 'draft',
      selected_timings: selectedTimings,
      custom_dates: customDates,
      created_by: user.id,
    };
    
    reqLogger.info('Attempting to create campaign', { tenantId, name: campaignData.name, type: campaignData.campaign_type })

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert(campaignData)
      .select('id,name')
      .single();

    if (error || !campaign) {
      const err = error as any
      safeLog('Campaign creation error:', err)
      return serverError('Failed to create campaign', { details: err?.message || String(err), code: err?.code }, request)
    }

    // Increment total campaigns created for trial tracking
    if (isTrialing) {
      await supabase
        .from('tenants')
        .update({ 
          total_campaigns_created: campaignCount + 1 
        })
        .eq('id', tenantId);
      reqLogger.info('Incremented trial total_campaigns_created', { tenantId, newCount: campaignCount + 1 })
    }

    // Log activity
    try {
      await supabase
        .from('activity_logs')
        .insert({
          tenant_id: tenantId,
          user_id: user.id,
          action: 'campaign_created',
          details: {
            campaign_id: campaign.id,
            campaign_name: campaign.name
          }
        });
    } catch (e) {
      // Non-blocking: activity_logs may not exist in some environments
      safeLog('activity_logs insert skipped:', e)
    }

    // For compatibility with clients expecting top-level `campaign`, include it directly.
    reqLogger.apiResponse('POST', '/api/campaigns/create', 201, 0, { area: 'campaigns', op: 'create', status: 'ok', tenantId })
    return ok({ campaign }, request)
  } catch (error) {
    safeLog('Campaign creation error (unhandled):', error)
    return serverError('An unexpected error occurred', undefined, request)
  }
}
