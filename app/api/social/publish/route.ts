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
      scheduleFor,
      gmbOptions,
    } = await request.json();

    if (!postId || !content || !connectionIds || connectionIds.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check if post is approved before publishing
    const { data: post } = await supabase
      .from("campaign_posts")
      .select("approval_status")
      .eq("id", postId)
      .single();

    if (!post || post.approval_status !== 'approved') {
      return NextResponse.json({ 
        error: "Post must be approved before publishing" 
      }, { status: 403 });
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
            case "instagram_business":
              // Instagram requires business account and different API
              publishResult = await publishToInstagram(
                connection.page_id,
                connection.access_token,
                content,
                imageUrl
              );
              break;

            case "twitter": {
              publishResult = await publishToTwitterImmediate(
                content,
                imageUrl,
                connection
              );
              break;
            }

            case "google_my_business": {
              publishResult = await publishToGoogleMyBusinessImmediate(
                content,
                imageUrl,
                connection,
                gmbOptions
              );
              break;
            }

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

// --- Twitter immediate publish using connection tokens with refresh support ---
async function publishToTwitterImmediate(
  text: string,
  imageUrl: string | undefined,
  connection: any
): Promise<{ id: string }> {
  // Ensure we have a valid access token; refresh if expired
  let accessToken = connection.access_token as string | null;
  const refreshToken = connection.refresh_token as string | null;
  const expiresAt = connection.token_expires_at as string | null;

  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  if ((!accessToken || isExpired) && refreshToken) {
    const tokens = await refreshTwitterToken(refreshToken);
    if (tokens) {
      accessToken = tokens.access_token;
    }
  }

  if (!accessToken) {
    throw new Error('Twitter access token missing or invalid');
  }

  // If image is provided, upload via v1.1 media endpoint
  let mediaId: string | undefined;
  if (imageUrl) {
    mediaId = await uploadTwitterMediaDirect(imageUrl, accessToken);
  }

  const tweetBody: any = { text };
  if (mediaId) tweetBody.media = { media_ids: [mediaId] };

  const resp = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(tweetBody)
  });
  if (!resp.ok) {
    const e = await resp.text();
    throw new Error(`Twitter post failed: ${e}`);
  }
  const data = await resp.json();
  return { id: data.data?.id };
}

async function refreshTwitterToken(refreshToken: string): Promise<{ access_token: string, refresh_token?: string, expires_in?: number } | null> {
  const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
  const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
  const resp = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: TWITTER_CLIENT_ID,
    }),
  });
  if (!resp.ok) {
    return null;
  }
  return await resp.json();
}

async function uploadTwitterMediaDirect(imageUrl: string, accessToken: string): Promise<string | undefined> {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) return undefined;
  const buf = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
  const upload = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `media_data=${encodeURIComponent(buf)}`,
  });
  if (!upload.ok) return undefined;
  const data = await upload.json();
  return data.media_id_string;
}

// --- Google My Business immediate publish (text-only minimal) ---
async function publishToGoogleMyBusinessImmediate(
  text: string,
  imageUrl: string | undefined,
  connection: any,
  gmbOptions?: any
): Promise<{ id: string }> {
  const { GoogleMyBusinessClient } = await import('@/lib/social/google-my-business/client');

  const client = new GoogleMyBusinessClient({
    clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-my-business/callback`,
    accessToken: connection.access_token || undefined,
    refreshToken: connection.refresh_token || undefined,
  });

  // Normalize account and location IDs
  const accountId = normalizeAccountId(connection.account_id);
  const locationId = normalizeLocationId(connection.page_id);

  // Post payload per client types; attach media if provided and merge CTA/events/offers
  const post: any = { summary: text, topicType: 'STANDARD' };
  if (imageUrl) {
    post.media = [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }];
  }
  if (gmbOptions && typeof gmbOptions === 'object') {
    if (gmbOptions.callToAction && typeof gmbOptions.callToAction === 'object') {
      post.callToAction = gmbOptions.callToAction;
    }
    if (gmbOptions.event && typeof gmbOptions.event === 'object') {
      post.topicType = 'EVENT';
      post.event = gmbOptions.event;
    }
    if (gmbOptions.offer && typeof gmbOptions.offer === 'object') {
      post.topicType = 'OFFER';
      post.offer = gmbOptions.offer;
    }
  }
  const res = await client.createPost(accountId, locationId, post);
  if (!res.success || !res.postId) {
    throw new Error(res.error || 'Failed to create GMB post');
  }
  return { id: res.postId };
}

function normalizeAccountId(accountId: string | null): string {
  if (!accountId) return '';
  // strip leading 'accounts/' if present
  if (accountId.startsWith('accounts/')) return accountId.split('/')[1] || '';
  return accountId;
}

function normalizeLocationId(loc: string | null): string {
  if (!loc) return '';
  // possible forms: 'locations/123', 'accounts/456/locations/123', or bare '123'
  const parts = loc.split('/');
  const idx = parts.lastIndexOf('locations');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  if (loc.startsWith('locations/')) return loc.split('/')[1] || '';
  return loc;
}
