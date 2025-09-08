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
      return unauthorized('Authentication required', undefined, request)
    }

    // Verify the campaign exists and belongs to the user's tenant
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, name, tenant_id")
      .eq("id", id)
      .single();

    if (campaignError || !campaign) {
      return notFound('Campaign not found', undefined, request)
    }

    // Get user's tenant to verify access
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData || userData.tenant_id !== campaign.tenant_id) {
      return forbidden('Forbidden', undefined, request)
    }

    // Delete the campaign (posts will be cascade deleted automatically due to foreign key constraint)
    const { error: deleteError } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Campaign deletion error:", deleteError);
      return serverError('Failed to delete campaign', deleteError.message, request)
    }

    return ok({ success: true, message: `Campaign "${campaign.name}" deleted successfully` }, request)

  } catch (error) {
    console.error("Unexpected error during campaign deletion:", error);
    return serverError('Internal server error', undefined, request)
  }
}
