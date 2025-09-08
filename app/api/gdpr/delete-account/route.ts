import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { unauthorized, notFound, badRequest, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: user } = await supabase.auth.getUser();
    
    if (!user.user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const parsed = z.object({ reason: z.string().optional() }).safeParse(await request.json())
    const reason = parsed.success ? parsed.data.reason : undefined

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
      return notFound('User data not found', undefined, request)
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
      return serverError('Failed to create deletion request', requestError.message, request)
    }

    // Trigger soft delete of user data (starts 30-day UK ICO retention period)
    const { error: deleteError } = await supabase.rpc('soft_delete_user_data', {
      target_user_id: user.user.id
    });

    if (deleteError) {
      console.error("Error soft deleting user data:", deleteError);
      return serverError('Failed to initiate account deletion', deleteError.message, request)
    }

    // Update deletion request status
    await supabase
      .from('user_deletion_requests')
      .update({ status: 'processing' })
      .eq('user_id', user.user.id);

    // Log the deletion request
    console.log(`Account deletion requested for user ${user.user.id} at ${new Date().toISOString()}`);

    return ok({
      success: true,
      message: "Account deletion initiated. Per UK data protection law, your data will be permanently deleted in 30 days.",
      deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      uk_ico_compliant: true
    }, request);

  } catch (error) {
    console.error("Account deletion error:", error);
    return serverError('Account deletion failed', String(error), request)
  }
}
