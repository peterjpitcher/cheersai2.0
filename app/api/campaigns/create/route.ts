import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCampaignSchema } from "@/lib/validation/schemas";
import { withAuthValidation, errorResponse } from "@/lib/validation/middleware";

export async function POST(request: NextRequest) {
  return withAuthValidation(request, createCampaignSchema, async (validatedData, auth) => {
    try {
      const supabase = await createClient();
      const { user, tenantId } = auth;
      
      // Validate start/end dates are not in the past
      const now = new Date();
      if (validatedData.startDate) {
        const startDate = new Date(validatedData.startDate);
        if (startDate < now) {
          return errorResponse("Start date cannot be in the past", 400);
        }
      }
      
      if (validatedData.endDate) {
        const endDate = new Date(validatedData.endDate);
        if (endDate < now) {
          return errorResponse("End date cannot be in the past", 400);
        }
        
        if (validatedData.startDate && new Date(validatedData.endDate) < new Date(validatedData.startDate)) {
          return errorResponse("End date cannot be before start date", 400);
        }
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

      if (!tenant || tenant.subscription_status !== 'active') {
        return errorResponse("Active subscription required to create campaigns", 403);
      }

      // Basic tier limits (can be moved to config)
      const campaignLimits = {
        starter: 5,
        professional: 20,
        enterprise: 999999
      };

      const currentLimit = campaignLimits[tenant.subscription_tier as keyof typeof campaignLimits] || 5;
      
      if (existingCampaigns && existingCampaigns.length >= currentLimit) {
        return errorResponse(`Campaign limit reached for ${tenant.subscription_tier} tier`, 403);
      }

      // Create campaign with tenant_id
      const finalCampaignData = {
        ...validatedData,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Create the campaign
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .insert(finalCampaignData)
        .select()
        .single();

      if (campaignError) {
        console.error("Campaign creation error:", campaignError);
        return errorResponse("Failed to create campaign", 500);
      }

      return NextResponse.json({ 
        success: true,
        campaign
      });

    } catch (error) {
      console.error("Unexpected error during campaign creation:", error);
      return errorResponse("Internal server error", 500);
    }
  });
}