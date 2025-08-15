import { createClient } from '@/lib/supabase/server';

// Instagram Business API uses the same Facebook Graph API
// Instagram accounts must be connected to a Facebook Page

export interface InstagramAccount {
  id: string;
  username: string;
  profile_picture_url?: string;
  followers_count?: number;
  media_count?: number;
  biography?: string;
  website?: string;
  ig_id: number;
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  comments_count?: number;
  like_count?: number;
}

export interface InstagramPublishParams {
  caption: string;
  image_url?: string;
  video_url?: string;
  media_type?: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  children?: Array<{ media_url: string; media_type: 'IMAGE' | 'VIDEO' }>;
  location_id?: string;
  user_tags?: Array<{ username: string; x?: number; y?: number }>;
}

export class InstagramClient {
  private accessToken: string;
  private instagramAccountId?: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getConnectedInstagramAccounts(pageId: string): Promise<InstagramAccount[]> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account{id,username,profile_picture_url,followers_count,media_count,biography,website,ig_id}&access_token=${this.accessToken}`
      );

      if (!response.ok) {
        throw new Error(`Failed to get Instagram accounts: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.instagram_business_account) {
        return [];
      }

      return [data.instagram_business_account];
    } catch (error) {
      console.error('Error getting Instagram accounts:', error);
      throw error;
    }
  }

  setInstagramAccount(accountId: string) {
    this.instagramAccountId = accountId;
  }

  async publishToInstagram(params: InstagramPublishParams): Promise<{ id: string; permalink?: string }> {
    if (!this.instagramAccountId) {
      throw new Error('No Instagram account selected');
    }

    try {
      let mediaContainerId: string;

      if (params.media_type === 'CAROUSEL') {
        // Handle carousel posts (multiple images/videos)
        mediaContainerId = await this.createCarouselContainer(params);
      } else if (params.video_url) {
        // Handle video posts
        mediaContainerId = await this.createVideoContainer(params);
      } else if (params.image_url) {
        // Handle single image posts
        mediaContainerId = await this.createImageContainer(params);
      } else {
        throw new Error('No media provided for Instagram post');
      }

      // Publish the media container
      const publishResponse = await fetch(
        `https://graph.facebook.com/v18.0/${this.instagramAccountId}/media_publish`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            creation_id: mediaContainerId,
            access_token: this.accessToken,
          }),
        }
      );

      if (!publishResponse.ok) {
        const error = await publishResponse.json();
        throw new Error(`Failed to publish to Instagram: ${JSON.stringify(error)}`);
      }

      const publishData = await publishResponse.json();

      // Get the permalink of the published post
      const permalink = await this.getMediaPermalink(publishData.id);

      return {
        id: publishData.id,
        permalink,
      };
    } catch (error) {
      console.error('Error publishing to Instagram:', error);
      throw error;
    }
  }

  private async createImageContainer(params: InstagramPublishParams): Promise<string> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${this.instagramAccountId}/media`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: params.image_url,
          caption: params.caption,
          location_id: params.location_id,
          user_tags: params.user_tags,
          access_token: this.accessToken,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create image container: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    return data.id;
  }

  private async createVideoContainer(params: InstagramPublishParams): Promise<string> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${this.instagramAccountId}/media`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_url: params.video_url,
          caption: params.caption,
          location_id: params.location_id,
          access_token: this.accessToken,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create video container: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    
    // Wait for video to process
    await this.waitForMediaProcessing(data.id);
    
    return data.id;
  }

  private async createCarouselContainer(params: InstagramPublishParams): Promise<string> {
    if (!params.children || params.children.length < 2 || params.children.length > 10) {
      throw new Error('Carousel must have between 2 and 10 media items');
    }

    // Create containers for each child media
    const childIds: string[] = [];
    for (const child of params.children) {
      const childResponse = await fetch(
        `https://graph.facebook.com/v18.0/${this.instagramAccountId}/media`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_url: child.media_type === 'IMAGE' ? child.media_url : undefined,
            video_url: child.media_type === 'VIDEO' ? child.media_url : undefined,
            is_carousel_item: true,
            access_token: this.accessToken,
          }),
        }
      );

      if (!childResponse.ok) {
        const error = await childResponse.json();
        throw new Error(`Failed to create carousel child: ${JSON.stringify(error)}`);
      }

      const childData = await childResponse.json();
      
      if (child.media_type === 'VIDEO') {
        await this.waitForMediaProcessing(childData.id);
      }
      
      childIds.push(childData.id);
    }

    // Create the carousel container
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${this.instagramAccountId}/media`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: params.caption,
          location_id: params.location_id,
          children: childIds,
          media_type: 'CAROUSEL',
          access_token: this.accessToken,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create carousel container: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    return data.id;
  }

  private async waitForMediaProcessing(containerId: string, maxAttempts: number = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${containerId}?fields=status_code&access_token=${this.accessToken}`
      );

      if (!response.ok) {
        throw new Error('Failed to check media status');
      }

      const data = await response.json();
      
      if (data.status_code === 'FINISHED') {
        return;
      } else if (data.status_code === 'ERROR') {
        throw new Error('Media processing failed');
      }

      // Wait 2 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Media processing timeout');
  }

  private async getMediaPermalink(mediaId: string): Promise<string> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${mediaId}?fields=permalink&access_token=${this.accessToken}`
      );

      if (!response.ok) {
        return '';
      }

      const data = await response.json();
      return data.permalink || '';
    } catch {
      return '';
    }
  }

  async getInstagramInsights(mediaId: string): Promise<any> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${mediaId}/insights?metric=impressions,reach,engagement&access_token=${this.accessToken}`
      );

      if (!response.ok) {
        throw new Error('Failed to get Instagram insights');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting Instagram insights:', error);
      throw error;
    }
  }

  async getRecentMedia(limit: number = 25): Promise<InstagramMedia[]> {
    if (!this.instagramAccountId) {
      throw new Error('No Instagram account selected');
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${this.instagramAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=${limit}&access_token=${this.accessToken}`
      );

      if (!response.ok) {
        throw new Error('Failed to get recent media');
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error getting recent media:', error);
      throw error;
    }
  }
}

export async function publishToInstagram(
  content: string,
  imageUrl?: string,
  tenantId?: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    if (!tenantId) {
      return { success: false, error: 'Tenant ID is required' };
    }

    if (!imageUrl) {
      return { success: false, error: 'Instagram requires an image or video' };
    }

    const supabase = await createClient();
    const { data: account } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('platform', 'instagram')
      .single();

    if (!account || !account.access_token) {
      return { success: false, error: 'Instagram account not connected' };
    }

    const client = new InstagramClient(account.access_token);
    client.setInstagramAccount(account.instagram_id);

    const result = await client.publishToInstagram({
      caption: content,
      image_url: imageUrl,
    });

    return {
      success: true,
      postId: result.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to publish to Instagram',
    };
  }
}