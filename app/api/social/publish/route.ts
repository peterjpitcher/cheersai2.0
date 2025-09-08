import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFacebookPageAccessToken } from "@/lib/social/facebook";
import { decryptToken } from "@/lib/security/encryption";

export const runtime = 'nodejs'

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
        // Pre-checks for platform-specific requirements before scheduling
        if ((connection.platform === 'instagram' || connection.platform === 'instagram_business') && !imageUrl) {
          results.push({
            connectionId,
            success: false,
            error: 'Instagram requires an image',
          });
          continue;
        }

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
              {
                const pageToken = connection.access_token_encrypted
                  ? decryptToken(connection.access_token_encrypted)
                  : connection.access_token;
              publishResult = await publishToFacebook(
                connection.page_id,
                pageToken,
                content,
                imageUrl
              );
              break;
              }

            case "instagram":
            case "instagram_business":
              // Instagram requires business account and different API
              {
                const igToken = connection.access_token_encrypted
                  ? decryptToken(connection.access_token_encrypted)
                  : connection.access_token;
              publishResult = await publishToInstagram(
                connection.page_id,
                igToken,
                content,
                imageUrl
              );
              break;
              }

            case "twitter": {
              const twAccess = connection.access_token_encrypted
                ? decryptToken(connection.access_token_encrypted)
                : connection.access_token;
              publishResult = await publishToTwitterImmediate(
                content,
                imageUrl,
                { ...connection, access_token: twAccess }
              );
              break;
            }

            case "google_my_business": {
              const gmbAccess = connection.access_token_encrypted
                ? decryptToken(connection.access_token_encrypted)
                : connection.access_token;
              publishResult = await publishToGoogleMyBusinessImmediate(
                content,
                imageUrl,
                { ...connection, access_token: gmbAccess },
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
              external_id: publishResult.id,
              account_name: connection.page_name || connection.account_name,
              connection_id: connectionId,
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
              account_name: connection.page_name || connection.account_name,
              connection_id: connectionId,
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
  pageAccessToken: string,
  message: string,
  imageUrl?: string
): Promise<{ id: string }> {
  // We already store a PAGE access token during connect; no exchange needed here
  const base = `https://graph.facebook.com/v18.0/${pageId}/`;

  if (imageUrl) {
    const params = new URLSearchParams();
    params.set('message', message);
    params.set('url', imageUrl);
    params.set('access_token', pageAccessToken);

    const response = await fetch(base + 'photos', { method: 'POST', body: params });
    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || data.error) {
      const msg = data.error?.message || text || 'Failed to post photo to Facebook';
      throw new Error(msg);
    }
    return { id: data.id };
  } else {
    const params = new URLSearchParams();
    params.set('message', message);
    params.set('access_token', pageAccessToken);

    const response = await fetch(base + 'feed', { method: 'POST', body: params });
    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || data.error) {
      const msg = data.error?.message || text || 'Failed to post to Facebook feed';
      throw new Error(msg);
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

  // Create media container (use form-encoded params for Graph API reliability)
  const containerParams = new URLSearchParams();
  containerParams.set('image_url', imageUrl);
  containerParams.set('caption', caption);
  containerParams.set('access_token', accessToken);
  const containerResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media`,
    { method: 'POST', body: containerParams }
  );
  const containerText = await containerResponse.text();
  let containerData: any = {};
  try { containerData = JSON.parse(containerText); } catch {}
  if (!containerResponse.ok || containerData.error) {
    const msg = containerData.error?.message || containerText || 'Failed to create Instagram container';
    throw new Error(msg);
  }

  // Publish the container
  const publishParams = new URLSearchParams();
  publishParams.set('creation_id', containerData.id);
  publishParams.set('access_token', accessToken);
  const publishResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`,
    { method: 'POST', body: publishParams }
  );
  const publishText = await publishResponse.text();
  let publishData: any = {};
  try { publishData = JSON.parse(publishText); } catch {}
  if (!publishResponse.ok || publishData.error) {
    const msg = publishData.error?.message || publishText || 'Failed to publish Instagram media';
    throw new Error(msg);
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
    tenantId: connection.tenant_id,
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
