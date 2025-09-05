import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's tenant ID
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    const tenantId = userData.tenant_id;
    const body = await request.json();
    
    // Validate required fields
    if (!body.name) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }

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
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Check trial limits first (10 campaigns total during trial)
    const isTrialing = tenant.subscription_status === 'trialing' || tenant.subscription_status === null;
    
    if (isTrialing && tenant.total_campaigns_created >= 10) {
      return NextResponse.json({ 
        error: "You've reached the free trial limit of 10 campaigns. Please upgrade to continue creating campaigns.",
        currentCount: tenant.total_campaigns_created,
        limit: 10
      }, { status: 403 });
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
      return NextResponse.json({ 
        error: `Campaign limit reached. Your ${tenant.subscription_tier} plan allows ${limit} active campaigns.`,
        currentCount: existingCampaigns.length,
        limit
      }, { status: 403 });
    }

    // Create the campaign - log the data being inserted for debugging
    const campaignData = {
      tenant_id: tenantId,
      name: body.name,
      campaign_type: body.campaign_type,
      event_date: body.event_date,
      description: body.description || null,
      hero_image_id: body.hero_image_id || null,
      status: body.status || 'draft',
      selected_timings: body.selected_timings || [],
      custom_dates: body.custom_dates || [],
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
      return NextResponse.json({ 
        error: "Failed to create campaign",
        details: error.message,
        code: error.code
      }, { status: 500 });
    }

    // Increment total campaigns created for trial tracking
    if (isTrialing) {
      await supabase
        .from('tenants')
        .update({ 
          total_campaigns_created: (tenant.total_campaigns_created || 0) + 1 
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

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    console.error('Campaign creation error:', error);
    return NextResponse.json({ 
      error: "An unexpected error occurred" 
    }, { status: 500 });
  }
}
