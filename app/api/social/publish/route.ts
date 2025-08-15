import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { 
      postId, 
      content, 
      connectionIds,
      imageUrl,
      scheduleFor 
    } = await request.json();

    if (!postId || !content || !connectionIds || connectionIds.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const results = [];

    for (const connectionId of connectionIds) {
      // Get connection details
      const { data: connection } = await supabase
        .from("social_connections")
        .select("*")
        .eq("id", connectionId)
        .single();

      if (!connection || !connection.is_active) {
        results.push({
          connectionId,
          success: false,
          error: "Connection not found or inactive",
        });
        continue;
      }

      if (scheduleFor && new Date(scheduleFor) > new Date()) {
        // Add to publishing queue for scheduled posting
        const { error: queueError } = await supabase
          .from("publishing_queue")
          .insert({
            campaign_post_id: postId,
            social_connection_id: connectionId,
            scheduled_for: scheduleFor,
            status: "pending",
          });

        if (queueError) {
          results.push({
            connectionId,
            success: false,
            error: "Failed to schedule post",
          });
        } else {
          results.push({
            connectionId,
            success: true,
            scheduled: true,
          });
        }
      } else {
        // Publish immediately
        try {
          let publishResult;

          switch (connection.platform) {
            case "facebook":
              publishResult = await publishToFacebook(
                connection.page_id,
                connection.access_token,
                content,
                imageUrl
              );
              break;

            case "instagram":
              // Instagram requires business account and different API
              publishResult = await publishToInstagram(
                connection.page_id,
                connection.access_token,
                content,
                imageUrl
              );
              break;

            default:
              throw new Error("Unsupported platform");
          }

          // Record in publishing history
          await supabase
            .from("publishing_history")
            .insert({
              campaign_post_id: postId,
              social_connection_id: connectionId,
              platform: connection.platform,
              status: "published",
              published_at: new Date().toISOString(),
              platform_post_id: publishResult.id,
            });

          results.push({
            connectionId,
            success: true,
            postId: publishResult.id,
          });
        } catch (error: any) {
          // Record failure
          await supabase
            .from("publishing_history")
            .insert({
              campaign_post_id: postId,
              social_connection_id: connectionId,
              platform: connection.platform,
              status: "failed",
              error_message: error.message,
            });

          results.push({
            connectionId,
            success: false,
            error: error.message,
          });
        }
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Publishing error:", error);
    return NextResponse.json(
      { error: "Failed to publish content" },
      { status: 500 }
    );
  }
}

async function publishToFacebook(
  pageId: string,
  accessToken: string,
  message: string,
  imageUrl?: string
): Promise<{ id: string }> {
  const url = `https://graph.facebook.com/v18.0/${pageId}/`;
  
  if (imageUrl) {
    // Post with image
    const response = await fetch(url + "photos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        url: imageUrl,
        access_token: accessToken,
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    return { id: data.id };
  } else {
    // Text-only post
    const response = await fetch(url + "feed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        access_token: accessToken,
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    return { id: data.id };
  }
}

async function publishToInstagram(
  pageId: string,
  accessToken: string,
  caption: string,
  imageUrl?: string
): Promise<{ id: string }> {
  if (!imageUrl) {
    throw new Error("Instagram requires an image");
  }

  // Get Instagram Business Account ID
  const accountResponse = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`
  );
  const accountData = await accountResponse.json();
  
  if (!accountData.instagram_business_account) {
    throw new Error("No Instagram Business Account connected to this Facebook Page");
  }

  const igAccountId = accountData.instagram_business_account.id;

  // Create media container
  const containerResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    }
  );

  const containerData = await containerResponse.json();
  
  if (containerData.error) {
    throw new Error(containerData.error.message);
  }

  // Publish the container
  const publishResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: accessToken,
      }),
    }
  );

  const publishData = await publishResponse.json();
  
  if (publishData.error) {
    throw new Error(publishData.error.message);
  }

  return { id: publishData.id };
}