import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const campaignData = await request.json();
    
    // Validate event date is not in the past
    if (campaignData.event_date) {
      const eventDate = new Date(campaignData.event_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);
      
      if (eventDate < today) {
        return NextResponse.json({ 
          error: "Campaign event date cannot be in the past. Please select today or a future date." 
        }, { status: 400 });
      }
    }
    
    // Validate custom dates are not in the past
    if (campaignData.custom_dates && Array.isArray(campaignData.custom_dates)) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      for (const customDate of campaignData.custom_dates) {
        const customDateTime = new Date(customDate);
        customDateTime.setHours(0, 0, 0, 0);
        if (customDateTime < today) {
          return NextResponse.json({ 
            error: "Custom post dates cannot be in the past. Please select today or future dates only." 
          }, { status: 400 });
        }
      }
    }
    
    // Get user's tenant
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData?.tenant_id) {
      return NextResponse.json({ error: "User tenant not found" }, { status: 404 });
    }

    // Add tenant_id to campaign data
    const finalCampaignData = {
      ...campaignData,
      tenant_id: userData.tenant_id,
    };

    // Create the campaign
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .insert(finalCampaignData)
      .select()
      .single();

    if (campaignError) {
      console.error("Campaign creation error:", campaignError);
      return NextResponse.json({ 
        error: "Failed to create campaign",
        details: campaignError.message 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true,
      campaign
    });

  } catch (error) {
    console.error("Unexpected error during campaign creation:", error);
    return NextResponse.json({ 
      error: "Internal server error" 
    }, { status: 500 });
  }
}