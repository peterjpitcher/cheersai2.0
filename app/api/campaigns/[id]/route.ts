import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface DeleteParams {
  params: Promise<{ id: string }>;
}

export const runtime = 'nodejs'

export async function DELETE(request: NextRequest, { params }: DeleteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the campaign exists and belongs to the user's tenant
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, name, tenant_id")
      .eq("id", id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Get user's tenant to verify access
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData || userData.tenant_id !== campaign.tenant_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete the campaign (posts will be cascade deleted automatically due to foreign key constraint)
    const { error: deleteError } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Campaign deletion error:", deleteError);
      return NextResponse.json({ 
        error: "Failed to delete campaign",
        details: deleteError.message 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Campaign "${campaign.name}" deleted successfully` 
    });

  } catch (error) {
    console.error("Unexpected error during campaign deletion:", error);
    return NextResponse.json({ 
      error: "Internal server error" 
    }, { status: 500 });
  }
}
