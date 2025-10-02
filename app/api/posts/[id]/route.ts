import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { createServiceRoleClient } from "@/lib/server-only";
import type { Database } from '@/lib/types/database'

interface PostUpdateParams {
  params: Promise<{ id: string }>;
}

export const runtime = 'nodejs'

export async function PUT(request: NextRequest, { params }: PostUpdateParams) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get request body
    const body = await request.json() as Partial<Database['public']['Tables']['campaign_posts']['Insert']>
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

    // Prevent edits if post is currently publishing
    const { data: current } = await supabase
      .from('campaign_posts')
      .select('is_publishing')
      .eq('id', id)
      .single()
    if (current?.is_publishing) {
      return NextResponse.json({ ok: false, error: { code: 'locked', message: 'This post is currently publishing. Try again shortly.' } }, { status: 409 })
    }

    // Prepare update data
    const updateData: Database['public']['Tables']['campaign_posts']['Update'] = {};
    const shouldSyncQueue = scheduled_for !== undefined;
    
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
      reqLogger.error('Failed to update campaign post', {
        area: 'campaigns',
        op: 'post.update',
        status: 'fail',
        error: updateError,
        meta: { postId: id },
      })
      return serverError('Failed to update post', updateError.message, request)
    }

    reqLogger.info('Campaign post updated', {
      area: 'campaigns',
      op: 'post.update',
      status: 'ok',
      meta: { postId: id },
    })

    if (shouldSyncQueue && updatedPost?.scheduled_for) {
      try {
        const svc = await createServiceRoleClient();
        await svc
          .from('publishing_queue')
          .update({
            scheduled_for: updatedPost.scheduled_for,
            next_attempt_at: null,
            attempts: 0,
            last_attempt_at: null,
            last_error: null,
            status: 'pending',
          })
          .eq('campaign_post_id', id);
      } catch (syncError) {
        reqLogger.warn('Failed to sync queue after post update', {
          area: 'queue',
          op: 'post.sync',
          status: 'fail',
          error: syncError instanceof Error ? syncError : new Error(String(syncError)),
          postId: id,
        });
      }
    }

    return ok({ success: true, post: updatedPost, message: "Post updated successfully" }, request)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Unexpected error during post update', {
      area: 'campaigns',
      op: 'post.update',
      status: 'fail',
      error: err,
    })
    logger.error('Unexpected error during post update', {
      area: 'campaigns',
      op: 'post.update',
      status: 'fail',
      error: err,
    })
    return serverError('Internal server error', undefined, request)
  }
}

export async function GET(request: NextRequest, { params }: PostUpdateParams) {
  const reqLogger = createRequestLogger(request as unknown as Request)
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

    const tenantId = userData.tenant_id
    if (!tenantId) {
      return notFound('Tenant not found', undefined, request)
    }
    const tenantIdValue = tenantId

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
      .eq("tenant_id", tenantIdValue)
      .single();

    if (postError || !post) {
      return notFound('Post not found', undefined, request)
    }

    reqLogger.info('Campaign post fetched', {
      area: 'campaigns',
      op: 'post.fetch',
      status: 'ok',
      meta: { postId: id },
    })

    return ok({ post }, request)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Unexpected error during post fetch', {
      area: 'campaigns',
      op: 'post.fetch',
      status: 'fail',
      error: err,
    })
    logger.error('Unexpected error during post fetch', {
      area: 'campaigns',
      op: 'post.fetch',
      status: 'fail',
      error: err,
    })
    return serverError('Internal server error', undefined, request)
  }
}

export async function DELETE(request: NextRequest, { params }: PostUpdateParams) {
  const reqLogger = createRequestLogger(request as unknown as Request)
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

    const tenantId = userData?.tenant_id
    if (userError || !tenantId || tenantId !== existingPost.tenant_id) {
      return forbidden('Forbidden', undefined, request)
    }
    const tenantIdValue = tenantId

    // Delete the post using service role to avoid RLS issues after auth + tenant check
    const svc = await createServiceRoleClient();
    const { error: deleteError } = await svc
      .from("campaign_posts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantIdValue);

    if (deleteError) {
      reqLogger.error('Failed to delete campaign post', {
        area: 'campaigns',
        op: 'post.delete',
        status: 'fail',
        error: deleteError,
        meta: { postId: id },
      })
      return serverError('Failed to delete post', deleteError.message, request)
    }

    reqLogger.info('Campaign post deleted', {
      area: 'campaigns',
      op: 'post.delete',
      status: 'ok',
      meta: { postId: id },
    })

    return ok({ success: true, message: "Post deleted successfully" }, request)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Unexpected error during post deletion', {
      area: 'campaigns',
      op: 'post.delete',
      status: 'fail',
      error: err,
    })
    logger.error('Unexpected error during post deletion', {
      area: 'campaigns',
      op: 'post.delete',
      status: 'fail',
      error: err,
    })
    return serverError('Internal server error', undefined, request)
  }
}
