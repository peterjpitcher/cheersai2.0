import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FacebookClient } from "@/lib/social/facebook";
import { InstagramClient } from "@/lib/social/instagram";

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

    // Get pending posts that are due
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
      .eq("status", "pending")
      .lte("scheduled_for", now.toISOString())
      .lt("attempts", 3) // Max 3 attempts
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
        
        // Check if we've exceeded max attempts
        if (item.attempts >= 2) {
          // Mark as failed after 3 attempts
          await supabase
            .from("publishing_queue")
            .update({ 
              status: "failed",
              error_message: error.message
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
              error_message: error.message
            });
        } else {
          // Reset to pending for retry
          await supabase
            .from("publishing_queue")
            .update({ 
              status: "pending",
              error_message: error.message
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