import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/server-only";
import { ok, unauthorized, forbidden, notFound, serverError } from '@/lib/http'

interface PostUpdateParams {
  params: Promise<{ id: string }>;
}

export const runtime = 'nodejs'

export async function PUT(request: NextRequest, { params }: PostUpdateParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get request body
    const body = await request.json();
    const { content, scheduled_for, platforms, platform, media_url, media_assets } = body;

    // Verify the post exists and belongs to the user's tenant
    const { data: existingPost, error: postError } = await supabase
      .from("campaign_posts")
      .select("id, tenant_id, is_quick_post")
      .eq("id", id)
      .single();

    if (postError || !existingPost) {
      return notFound('Post not found', undefined, request)
    }

    // Get user's tenant to verify access
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData || userData.tenant_id !== existingPost.tenant_id) {
      return forbidden('Forbidden', undefined, request)
    }

    // Prepare update data
    const updateData: any = {};
    
    if (content !== undefined) updateData.content = content;
    if (scheduled_for !== undefined) updateData.scheduled_for = scheduled_for;
    if (platforms !== undefined) updateData.platforms = platforms;
    if (platform !== undefined) updateData.platform = platform;
    if (media_url !== undefined) updateData.media_url = media_url;
    if (media_assets !== undefined) updateData.media_assets = media_assets;
    
    // Add updated timestamp
    updateData.updated_at = new Date().toISOString();

    // Update the post
    const { data: updatedPost, error: updateError } = await supabase
      .from("campaign_posts")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      console.error("Post update error:", updateError);
      return serverError('Failed to update post', updateError.message, request)
    }

    return ok({ success: true, post: updatedPost, message: "Post updated successfully" }, request)

  } catch (error) {
    console.error("Unexpected error during post update:", error);
    return serverError('Internal server error', undefined, request)
  }
}

export async function GET(request: NextRequest, { params }: PostUpdateParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get user's tenant
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData) {
      return notFound('User data not found', undefined, request)
    }

    // Fetch the post with campaign data
    const { data: post, error: postError } = await supabase
      .from("campaign_posts")
      .select(`
        *,
        campaign:campaigns(
          id,
          name,
          status,
          event_date
        )
      `)
      .eq("id", id)
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (postError || !post) {
      return notFound('Post not found', undefined, request)
    }

    return ok({ post }, request)

  } catch (error) {
    console.error("Unexpected error during post fetch:", error);
    return serverError('Internal server error', undefined, request)
  }
}

export async function DELETE(request: NextRequest, { params }: PostUpdateParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Verify the post exists and belongs to the user's tenant
    const { data: existingPost, error: postError } = await supabase
      .from("campaign_posts")
      .select("id, tenant_id, content")
      .eq("id", id)
      .single();

    if (postError || !existingPost) {
      return notFound('Post not found', undefined, request)
    }

    // Get user's tenant to verify access
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData || userData.tenant_id !== existingPost.tenant_id) {
      return forbidden('Forbidden', undefined, request)
    }

    // Delete the post using service role to avoid RLS issues after auth + tenant check
    const svc = await createServiceRoleClient();
    const { error: deleteError } = await svc
      .from("campaign_posts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", userData.tenant_id);

    if (deleteError) {
      console.error("Post deletion error:", deleteError);
      return serverError('Failed to delete post', deleteError.message, request)
    }

    return ok({ success: true, message: "Post deleted successfully" }, request)

  } catch (error) {
    console.error("Unexpected error during post deletion:", error);
    return serverError('Internal server error', undefined, request)
  }
}
