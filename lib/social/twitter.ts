import { createClient } from '@/lib/supabase/server';

interface TwitterResponse {
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
}

async function refreshTwitterToken(refreshToken: string, tenantId: string): Promise<boolean> {
  try {
    const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
    const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';

    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
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

    if (!response.ok) {
      console.error('Failed to refresh Twitter token');
      return false;
    }

    const tokens = await response.json();

    // Update tokens in database
    const supabase = await createClient();
    const { error } = await supabase
      .from('social_accounts')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || refreshToken,
        token_expires_at: tokens.expires_in 
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('platform', 'twitter');

    return !error;
  } catch (error) {
    console.error('Error refreshing Twitter token:', error);
    return false;
  }
}

export async function publishToTwitter(
  content: string,
  imageUrl?: string,
  tenantId?: string
): Promise<TwitterResponse> {
  try {
    if (!tenantId) {
      return {
        success: false,
        error: 'Tenant ID is required',
      };
    }

    // Get Twitter credentials from database
    const supabase = await createClient();
    const { data: account, error } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('platform', 'twitter')
      .single();

    if (error || !account) {
      return {
        success: false,
        error: 'Twitter account not connected',
      };
    }

    const accessToken = account.access_token;

    if (!accessToken) {
      return {
        success: false,
        error: 'Invalid Twitter credentials',
      };
    }

    // Check if token is expired and refresh if needed
    if (account.token_expires_at && new Date(account.token_expires_at) < new Date()) {
      // Refresh the token
      const refreshed = await refreshTwitterToken(account.refresh_token, tenantId);
      if (!refreshed) {
        return {
          success: false,
          error: 'Failed to refresh Twitter token',
        };
      }
    }

    // Build tweet data for API v2
    const tweetData: any = {
      text: content,
    };

    // Upload media if provided
    if (imageUrl) {
      const mediaId = await uploadTwitterMedia(imageUrl, accessToken);
      if (mediaId) {
        tweetData.media = {
          media_ids: [mediaId],
        };
      }
    }

    // Post to Twitter using API v2
    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tweetData),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Twitter API error:', error);
      return {
        success: false,
        error: error.detail || 'Failed to post to Twitter',
      };
    }

    const data = await response.json();
    const tweetId = data.data?.id;
    const username = account.username || 'user';

    return {
      success: true,
      postId: tweetId,
      url: tweetId ? `https://twitter.com/${username}/status/${tweetId}` : undefined,
    };
  } catch (error) {
    console.error('Error publishing to Twitter:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function uploadTwitterMedia(
  imageUrl: string,
  accessToken: string
): Promise<string | null> {
  try {
    // Download the image
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // Upload to Twitter
    const uploadResponse = await fetch(
      'https://upload.twitter.com/1.1/media/upload.json',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `media_data=${encodeURIComponent(base64Image)}`,
      }
    );

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload media to Twitter');
    }

    const data = await uploadResponse.json();
    return data.media_id_string;
  } catch (error) {
    console.error('Error uploading Twitter media:', error);
    return null;
  }
}