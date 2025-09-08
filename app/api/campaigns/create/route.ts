import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { createCampaignSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get user's tenant ID
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }

    const tenantId = userData.tenant_id;
    const body = await request.json();
    const parsed = z.object(createCampaignSchema.shape).safeParse(body)
    if (!parsed.success) {
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
      return notFound('Tenant not found', undefined, request)
    }

    // Check trial limits first (10 campaigns total during trial)
    const isTrialing = tenant.subscription_status === 'trialing' || tenant.subscription_status === null;
    const campaignCount = tenant.total_campaigns_created || 0;
    
    if (isTrialing && campaignCount >= 10) {
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
    
    console.log('Attempting to create campaign with data:', campaignData);

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert(campaignData)
      .select()
      .single();

    if (error) {
      console.error('Campaign creation error:', error);
      console.error('Error details:', { 
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint 
      });
      return serverError('Failed to create campaign', { details: error.message, code: error.code }, request)
    }

    // Increment total campaigns created for trial tracking
    if (isTrialing) {
      await supabase
        .from('tenants')
        .update({ 
          total_campaigns_created: campaignCount + 1 
        })
        .eq('id', tenantId);
    }

    // Log activity
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

    // For compatibility with clients expecting top-level `campaign`, include it directly.
    return NextResponse.json({ ok: true, campaign, data: { campaign }, requestId: request.headers.get('x-request-id') || '' }, { status: 201 });
  } catch (error) {
    console.error('Campaign creation error:', error);
    return serverError('An unexpected error occurred', undefined, request)
  }
}
