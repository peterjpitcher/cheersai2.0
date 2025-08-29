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
      .select('subscription_tier, subscription_status')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Basic tier limits (can be moved to config)
    const campaignLimits: Record<string, number> = {
      'free': 10,
      'starter': 50,
      'professional': 200,
      'enterprise': 999999
    };

    const limit = campaignLimits[tenant.subscription_tier] || 10;
    
    if (existingCampaigns && existingCampaigns.length >= limit) {
      return NextResponse.json({ 
        error: `Campaign limit reached. Your ${tenant.subscription_tier} plan allows ${limit} active campaigns.`,
        currentCount: existingCampaigns.length,
        limit
      }, { status: 403 });
    }

    // Create the campaign
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        description: body.description,
        status: body.status || 'draft',
        start_date: body.startDate,
        end_date: body.endDate,
        platforms: body.platforms || [],
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Campaign creation error:', error);
      return NextResponse.json({ 
        error: "Failed to create campaign",
        details: error.message 
      }, { status: 500 });
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

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error('Campaign creation error:', error);
    return NextResponse.json({ 
      error: "An unexpected error occurred" 
    }, { status: 500 });
  }
}