import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/datetime";
import { FacebookClient } from "@/lib/social/facebook";
import { InstagramClient } from "@/lib/social/instagram";
import { publishToTwitter } from "@/lib/social/twitter";
import { nextAttemptDate } from "@/lib/utils/backoff";
import { logger, createRequestLogger } from '@/lib/observability/logger'
import { mapProviderError } from '@/lib/errors'
import { captureException } from '@/lib/observability/sentry'
import { extractFirstUrl, mergeUtm, replaceUrl } from '@/lib/utm'

// This endpoint processes the publishing queue
// Should be called by a cron job every minute
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const reqLogger = createRequestLogger(request as unknown as Request)
    const startedAt = Date.now()
    // Verify this is called by our cron service (add your own auth here)
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      reqLogger.event('warn', { area: 'queue', op: 'cron.auth', status: 'fail', msg: 'Unauthorized cron' })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use service-role for internal cron to bypass RLS safely
    const supabase = await createServiceRoleClient();
    const now = new Date();

    // Get pending posts that are due to run by scheduled_for or next_attempt_at
    const { data: queueItems, error } = await supabase
      .from("publishing_queue")
      .select(`
        *,
        campaign_posts (
          content,
          media_assets,
          tenant_id
        ),
        social_connections (
          platform,
          access_token,
          access_token_encrypted,
          refresh_token_encrypted,
          page_id,
          account_id,
          account_name
        )
      `)
      .eq('status', 'pending')
      .or(`scheduled_for.lte.${now.toISOString()},next_attempt_at.lte.${now.toISOString()}`)
      .lt("attempts", 5) // Increased to 5 attempts
      .order("scheduled_for", { ascending: true })
      .limit(10); // Process max 10 items per run

    if (error) {
      logger.error("Error fetching queue items", { area: 'queue', op: 'fetch', error });
      captureException(error, { tags: { area: 'queue', op: 'fetch' } })
      return NextResponse.json({ error: "Failed to fetch queue" }, { status: 500 });
    }

    if (!queueItems || queueItems.length === 0) {
      return NextResponse.json({ message: "No items to process" });
    }

    const results = [] as any[];

    for (const item of queueItems) {
      // Update status to processing
      await supabase
        .from("publishing_queue")
        .update({ 
          status: "processing",
          last_attempt_at: now.toISOString(),
          attempts: (item.attempts || 0) + 1
        })
        .eq("id", item.id);

      try {
        // Get media URLs if needed
        let mediaUrls: string[] = [];
        if (item.campaign_posts.media_assets?.length > 0) {
          const { data: mediaAssets } = await supabase
            .from("media_assets")
            .select("file_url")
            .in("id", item.campaign_posts.media_assets);
          
          mediaUrls = mediaAssets?.map(m => m.file_url) || [];
        }

        let publishResult;
        const connection = item.social_connections;

        // Decrypt access token if encrypted
        const accessToken = connection.access_token_encrypted
          ? (await import('@/lib/security/encryption')).decryptToken(connection.access_token_encrypted)
          : connection.access_token;

        // Prepare post text with link tracking (short link + UTM) for scheduled posts
        let textToPost = String(item.campaign_posts.content || '')
        try {
          const url = extractFirstUrl(textToPost)
          if (url && item.campaign_posts.tenant_id) {
            const utm = { utm_source: connection.platform, utm_medium: 'social', utm_campaign: item.campaign_post_id ? 'campaign' : 'quick_post' }
            const finalTarget = mergeUtm(url, utm)
            const slug = await createOrGetShortLinkSlug(
              supabase,
              String(item.campaign_posts.tenant_id),
              finalTarget,
              null,
              connection.platform,
              String(item.social_connection_id)
            )
            if (slug) {
              const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
              textToPost = replaceUrl(textToPost, url, `${base}/r/${slug}`)
            }
          }
        } catch {}

        switch (connection.platform) {
          case "facebook":
            const fbClient = new FacebookClient(accessToken);
            publishResult = await fbClient.publishToPage(
              connection.page_id,
              textToPost,
              mediaUrls[0] // Facebook takes one image at a time
            );
            break;

          case "instagram":
            const igClient = new InstagramClient(accessToken);
            igClient.setInstagramAccount(connection.account_id);
            
            if (mediaUrls.length === 0) {
              throw new Error("Instagram requires at least one image");
            }
            
            if (mediaUrls.length > 1) {
              // Create carousel post
              publishResult = await igClient.publishToInstagram({
                caption: textToPost,
                media_type: "CAROUSEL",
                children: mediaUrls.map(url => ({
                  media_url: url,
                  media_type: "IMAGE"
                }))
              });
            } else {
              // Single image post
              publishResult = await igClient.publishToInstagram({
                caption: textToPost,
                image_url: mediaUrls[0]
              });
            }
            break;

          case "twitter":
            const twitterResult = await publishToTwitter(
              textToPost,
              mediaUrls[0], // Twitter supports one image at a time
              item.campaign_posts.tenant_id
            );
            
            if (!twitterResult.success) {
              throw new Error(twitterResult.error || "Failed to post to Twitter");
            }
            
            publishResult = {
              id: twitterResult.postId,
              permalink: twitterResult.url
            };
            break;

          default:
            throw new Error(`Unsupported platform: ${connection.platform}`);
        }

        // Mark as completed
        await supabase
          .from("publishing_queue")
          .update({ 
            status: "completed",
            next_attempt_at: null,
            last_error: null
          })
          .eq("id", item.id);

        // Record in publishing history
        await supabase
          .from("publishing_history")
          .insert({
            campaign_post_id: item.campaign_post_id,
            social_connection_id: item.social_connection_id,
            platform: connection.platform,
            status: "published",
            published_at: now.toISOString(),
            platform_post_id: publishResult.id,
            external_id: publishResult.id,
            account_name: connection.account_name,
            connection_id: item.social_connection_id
          });

        // Audit: publish action
        try {
          await supabase.from('audit_log').insert({
            tenant_id: item.campaign_posts.tenant_id,
            user_id: null,
            entity_type: 'campaign_post',
            entity_id: String(item.campaign_post_id),
            action: 'publish',
            meta: { platform: connection.platform, connection_id: item.social_connection_id, platform_post_id: publishResult.id }
          })
        } catch {}

        // Send success notification
        const { data: campaign } = await supabase
          .from("campaigns")
          .select("name, tenant_id")
          .eq("id", item.campaign_posts.campaigns?.id)
          .single();

        if (campaign) {
          const { data: users } = await supabase
            .from("users")
            .select("email, id")
            .eq("tenant_id", campaign.tenant_id);

          if (users && users.length > 0) {
            await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "post_published",
                recipientEmail: users[0].email,
                data: {
                  userId: users[0].id,
                  tenantId: campaign.tenant_id,
                  campaignName: campaign.name,
                  platform: connection.platform,
                  publishedAt: formatDateTime(new Date()),
                  postUrl: publishResult.permalink || ""
                }
              })
            });
          }
        }

        const durationMs = Date.now() - startedAt
        reqLogger.event('info', {
          area: 'queue',
          op: 'publish',
          status: 'ok',
          platform: connection.platform,
          connectionId: String(item.social_connection_id),
          tenantId: item.campaign_posts.tenant_id,
          durationMs,
          msg: 'Queue item published',
        })

        results.push({
          queueId: item.id,
          success: true,
          postId: publishResult.id
        });

      } catch (error: any) {
        const mapped = mapProviderError(error, (item.social_connections?.platform || 'generic') as any)
        logger.warn(`Failed to publish queue item ${item.id}`, { area: 'queue', op: 'publish', error, errorCode: mapped.code, platform: item.social_connections?.platform, connectionId: String(item.social_connection_id), tenantId: item.campaign_posts?.tenant_id })
        captureException(error, { tags: { area: 'queue', op: 'publish', platform: item.social_connections?.platform || 'unknown' } })
        
        // Categorize the error
        const isRetryableError = 
          error.message?.includes('rate limit') ||
          error.message?.includes('timeout') ||
          error.message?.includes('temporarily') ||
          error.message?.includes('503') ||
          error.message?.includes('502') ||
          error.message?.includes('429');

        const isPermanentError = 
          error.message?.includes('invalid token') ||
          error.message?.includes('unauthorized') ||
          error.message?.includes('forbidden') ||
          error.message?.includes('not found') ||
          error.message?.includes('400');

        // Check if we've exceeded max attempts or hit a permanent error
        if (item.attempts >= 4 || isPermanentError) {
          // Mark as failed after 5 attempts or permanent error
          await supabase
            .from("publishing_queue")
            .update({ 
              status: "failed",
              last_error: error.message
            })
            .eq("id", item.id);

          // Record failure in history
          await supabase
            .from("publishing_history")
            .insert({
              campaign_post_id: item.campaign_post_id,
              social_connection_id: item.social_connection_id,
              platform: item.social_connections.platform,
              status: "failed",
              error_message: error.message,
              account_name: item.social_connections.account_name,
              connection_id: item.social_connection_id
            });

          // Audit: publish_failed
          try {
            await supabase.from('audit_log').insert({
              tenant_id: item.campaign_posts?.tenant_id,
              user_id: null,
              entity_type: 'campaign_post',
              entity_id: String(item.campaign_post_id),
              action: 'publish_failed',
              meta: { platform: item.social_connections?.platform, error: error.message }
            })
          } catch {}

          // Send failure notification
          await sendFailureNotification(item, mapped.message);
        } else if (isRetryableError) {
          // Calculate exponential backoff: 2^attempts minutes (capped)
          const attempts = (item.attempts || 1);
          const nextRetryTime = nextAttemptDate(now, attempts, 60);

          // Set to retry with exponential backoff
          await supabase
            .from("publishing_queue")
            .update({ 
              status: "pending",
              last_error: error.message,
              scheduled_for: nextRetryTime.toISOString(),
              next_attempt_at: nextRetryTime.toISOString()
            })
            .eq("id", item.id);
        } else {
          // Unknown error - retry with shorter backoff
          const nextRetryTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

          await supabase
            .from("publishing_queue")
            .update({ 
              status: "pending",
              last_error: error.message,
              scheduled_for: nextRetryTime.toISOString(),
              next_attempt_at: nextRetryTime.toISOString()
            })
            .eq("id", item.id);
        }

        const durationMs = Date.now() - startedAt
        reqLogger.event('warn', {
          area: 'queue',
          op: 'publish',
          status: 'fail',
          platform: item.social_connections?.platform,
          connectionId: String(item.social_connection_id),
          tenantId: item.campaign_posts?.tenant_id,
          durationMs,
          errorCode: mapped.code,
          msg: mapped.message,
        })
        results.push({
          queueId: item.id,
          success: false,
          error: mapped.message,
          errorCode: mapped.code,
        });
      }
    }

    return NextResponse.json({ 
      processed: results.length,
      results 
    });

  } catch (error) {
    logger.error("Queue processing error", { area: 'queue', op: 'cron', error: error instanceof Error ? error : new Error(String(error)) })
    captureException(error, { tags: { area: 'queue', op: 'cron' } })
    return NextResponse.json(
      { error: "Failed to process queue" },
      { status: 500 }
    );
  }
}

// Create short link (mirrors logic in social publish handler)
async function createOrGetShortLinkSlug(
  supabase: any,
  tenantId: string,
  targetUrl: string,
  campaignId: string | null,
  platform: string,
  connectionId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('short_links')
    .select('slug')
    .eq('tenant_id', tenantId)
    .eq('target_url', targetUrl)
    .eq('platform', platform)
    .maybeSingle()
  if (existing?.slug) return existing.slug

  const slug = generateSlug()
  const { error } = await supabase
    .from('short_links')
    .insert({ tenant_id: tenantId, slug, target_url: targetUrl, campaign_id: campaignId, platform, connection_id: connectionId })
  if (error) return null
  return slug
}

function generateSlug(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < 7; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

// Helper function to send failure notifications
async function sendFailureNotification(item: any, errorMessage: string) {
  try {
    const supabase = await createClient();
    
    // Get campaign details
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("name, tenant_id")
      .eq("id", item.campaign_posts.campaigns?.id)
      .single();

    if (!campaign) return;

    // Get tenant users to notify
    const { data: users } = await supabase
      .from("users")
      .select("email, id")
      .eq("tenant_id", campaign.tenant_id);

    if (!users || users.length === 0) return;

    // Send email notification
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "post_failed",
        recipientEmail: users[0].email,
        data: {
          userId: users[0].id,
          tenantId: campaign.tenant_id,
          campaignName: campaign.name,
          platform: item.social_connections?.platform || "unknown",
          errorMessage: errorMessage,
          failedAt: formatDateTime(new Date()),
          attempts: item.attempts || 1
        }
      })
    });

    // Also create an in-app notification
    await supabase
      .from("notifications")
      .insert({
        user_id: users[0].id,
        tenant_id: campaign.tenant_id,
        type: "publishing_failed",
        title: "Post Publishing Failed",
        message: `Failed to publish to ${item.social_connections?.platform || "platform"} after ${item.attempts || 1} attempts: ${errorMessage}`,
        data: {
          campaign_id: item.campaign_posts.campaigns?.id,
          queue_item_id: item.id,
          platform: item.social_connections?.platform,
          error: errorMessage
        },
        read: false,
        created_at: new Date().toISOString()
      });
  } catch (error) {
    console.error("Error sending failure notification:", error);
  }
}

// GET endpoint to check queue status
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 400 });
    }

    // Get queue status for this tenant
    const { data: queueItems } = await supabase
      .from("publishing_queue")
      .select(`
        *,
        campaign_posts!inner (
          tenant_id,
          content,
          media_url,
          media_assets
        ),
        social_connections (
          platform,
          page_name
        )
      `)
      .eq("campaign_posts.tenant_id", userData.tenant_id)
      .order("scheduled_for", { ascending: true });

    return NextResponse.json({ queue: queueItems || [] });
  } catch (error) {
    console.error("Error fetching queue status:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue status" },
      { status: 500 }
    );
  }
}
