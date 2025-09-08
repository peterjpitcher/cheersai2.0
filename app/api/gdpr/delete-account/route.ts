import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: user } = await supabase.auth.getUser();
    
    if (!user.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { reason } = await request.json();

    // Check if user already has a pending deletion request
    const { data: existingRequest } = await supabase
      .from('user_deletion_requests')
      .select('id, status')
      .eq('user_id', user.user.id)
      .eq('status', 'pending')
      .single();

    if (existingRequest) {
      return NextResponse.json({
        error: "Account deletion already requested",
        message: "You already have a pending account deletion request. UK data protection law requires a 30-day retention period."
      }, { status: 400 });
    }

    // Get user's tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.user.id)
      .single();

    if (!userData) {
      return NextResponse.json({ error: "User data not found" }, { status: 404 });
    }

    // Create deletion request
    const { error: requestError } = await supabase
      .from('user_deletion_requests')
      .insert({
        user_id: user.user.id,
        tenant_id: userData.tenant_id,
        deletion_reason: reason || 'User requested account deletion',
        status: 'pending'
      });

    if (requestError) {
      console.error("Error creating deletion request:", requestError);
      return NextResponse.json({
        error: "Failed to create deletion request",
        details: requestError.message
      }, { status: 500 });
    }

    // Trigger soft delete of user data (starts 30-day UK ICO retention period)
    const { error: deleteError } = await supabase.rpc('soft_delete_user_data', {
      target_user_id: user.user.id
    });

    if (deleteError) {
      console.error("Error soft deleting user data:", deleteError);
      return NextResponse.json({
        error: "Failed to initiate account deletion",
        details: deleteError.message
      }, { status: 500 });
    }

    // Update deletion request status
    await supabase
      .from('user_deletion_requests')
      .update({ status: 'processing' })
      .eq('user_id', user.user.id);

    // Log the deletion request
    console.log(`Account deletion requested for user ${user.user.id} at ${new Date().toISOString()}`);

    return NextResponse.json({
      success: true,
      message: "Account deletion initiated. Per UK data protection law, your data will be permanently deleted in 30 days.",
      deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      uk_ico_compliant: true
    });

  } catch (error) {
    console.error("Account deletion error:", error);
    return NextResponse.json({
      error: "Account deletion failed",
      details: error
    }, { status: 500 });
  }
}
