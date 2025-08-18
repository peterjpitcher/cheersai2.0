import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FacebookClient } from "@/lib/social/facebook";
import { InstagramClient } from "@/lib/social/instagram";
import { publishToTwitter } from "@/lib/social/twitter";

// This endpoint processes the publishing queue
// Should be called by a cron job every minute
export async function POST(request: NextRequest) {
  try {
    // Verify this is called by our cron service (add your own auth here)
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createClient();
    const now = new Date();

    // Get pending posts that are due, including retry items
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
          page_id,
          account_id
        )
      `)
      .or(`status.eq.pending,status.eq.retry`)
      .lte("scheduled_for", now.toISOString())
      .lt("attempts", 5) // Increased to 5 attempts
      .order("scheduled_for", { ascending: true })
      .limit(10); // Process max 10 items per run

    if (error) {
      console.error("Error fetching queue items:", error);
      return NextResponse.json({ error: "Failed to fetch queue" }, { status: 500 });
    }

    if (!queueItems || queueItems.length === 0) {
      return NextResponse.json({ message: "No items to process" });
    }

    const results = [];

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

        switch (connection.platform) {
          case "facebook":
            const fbClient = new FacebookClient(connection.access_token);
            publishResult = await fbClient.publishToPage(
              connection.page_id,
              item.campaign_posts.content,
              mediaUrls[0] // Facebook takes one image at a time
            );
            break;

          case "instagram":
            const igClient = new InstagramClient(connection.access_token);
            igClient.setInstagramAccount(connection.account_id);
            
            if (mediaUrls.length === 0) {
              throw new Error("Instagram requires at least one image");
            }
            
            if (mediaUrls.length > 1) {
              // Create carousel post
              publishResult = await igClient.publishToInstagram({
                caption: item.campaign_posts.content,
                media_type: "CAROUSEL",
                children: mediaUrls.map(url => ({
                  media_url: url,
                  media_type: "IMAGE"
                }))
              });
            } else {
              // Single image post
              publishResult = await igClient.publishToInstagram({
                caption: item.campaign_posts.content,
                image_url: mediaUrls[0]
              });
            }
            break;

          case "twitter":
            const twitterResult = await publishToTwitter(
              item.campaign_posts.content,
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

        // Mark as published
        await supabase
          .from("publishing_queue")
          .update({ 
            status: "published"
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
            platform_post_id: publishResult.id
          });

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
                  publishedAt: new Date().toLocaleString("en-GB"),
                  postUrl: publishResult.permalink || ""
                }
              })
            });
          }
        }

        results.push({
          queueId: item.id,
          success: true,
          postId: publishResult.id
        });

      } catch (error: any) {
        console.error(`Failed to publish queue item ${item.id}:`, error);
        
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
              error_message: error.message,
              failed_at: now.toISOString()
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
              failed_at: now.toISOString()
            });

          // Send failure notification
          await sendFailureNotification(item, error.message);
        } else if (isRetryableError) {
          // Calculate exponential backoff: 2^attempts minutes
          const backoffMinutes = Math.pow(2, item.attempts || 1);
          const nextRetryTime = new Date(now.getTime() + backoffMinutes * 60 * 1000);

          // Set to retry with exponential backoff
          await supabase
            .from("publishing_queue")
            .update({ 
              status: "retry",
              error_message: error.message,
              scheduled_for: nextRetryTime.toISOString(),
              next_retry_at: nextRetryTime.toISOString()
            })
            .eq("id", item.id);
        } else {
          // Unknown error - retry with shorter backoff
          const nextRetryTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

          await supabase
            .from("publishing_queue")
            .update({ 
              status: "retry",
              error_message: error.message,
              scheduled_for: nextRetryTime.toISOString()
            })
            .eq("id", item.id);
        }

        results.push({
          queueId: item.id,
          success: false,
          error: error.message
        });
      }
    }

    return NextResponse.json({ 
      processed: results.length,
      results 
    });

  } catch (error) {
    console.error("Queue processing error:", error);
    return NextResponse.json(
      { error: "Failed to process queue" },
      { status: 500 }
    );
  }
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
          failedAt: new Date().toLocaleString("en-GB"),
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
          content
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