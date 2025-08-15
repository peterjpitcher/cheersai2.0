import { createClient } from '@/lib/supabase/server';

interface TwitterResponse {
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
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
    const accessTokenSecret = account.access_token_secret;

    if (!accessToken || !accessTokenSecret) {
      return {
        success: false,
        error: 'Invalid Twitter credentials',
      };
    }

    // For Twitter API v2, we would use OAuth 2.0
    // This is a simplified example
    const tweetData: any = {
      text: content,
    };

    // Add media if provided
    if (imageUrl) {
      // In production, you'd upload the image first and get a media_id
      // Then attach it to the tweet
      tweetData.media = {
        media_ids: ['placeholder_media_id'],
      };
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