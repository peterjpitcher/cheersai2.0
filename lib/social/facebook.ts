import { createClient } from '@/lib/supabase/server';
import { decryptToken } from '@/lib/security/encryption';

interface FacebookResponse {
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
}

export class FacebookClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async publishToPage(pageId: string, content: string, imageUrl?: string): Promise<{ id: string; permalink?: string }> {
    const params = new URLSearchParams({
      message: content,
      access_token: this.accessToken,
    });

    if (imageUrl) {
      params.append('url', imageUrl);
    }

    const endpoint = imageUrl
      ? `https://graph.facebook.com/v18.0/${pageId}/photos`
      : `https://graph.facebook.com/v18.0/${pageId}/feed`;

    const response = await fetch(endpoint, {
      method: 'POST',
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to post to Facebook');
    }

    const postId = data.id || data.post_id;
    const postUrl = postId ? `https://facebook.com/${postId}` : undefined;

    return {
      id: postId,
      permalink: postUrl,
    };
  }
}

export async function publishToFacebook(
  content: string,
  imageUrl?: string,
  tenantId?: string
): Promise<FacebookResponse> {
  try {
    if (!tenantId) {
      return {
        success: false,
        error: 'Tenant ID is required',
      };
    }

    // Get Facebook credentials from database (unified social_connections)
    const supabase = await createClient();
    const { data: account, error } = await supabase
      .from('social_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('platform', 'facebook')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !account) {
      return {
        success: false,
        error: 'Facebook account not connected',
      };
    }

    const accessToken = account.access_token_encrypted
      ? decryptToken(account.access_token_encrypted)
      : account.access_token;
    const pageId = account.page_id;

    if (!accessToken || !pageId) {
      return {
        success: false,
        error: 'Invalid Facebook credentials',
      };
    }

    // Build the request
    const params = new URLSearchParams({
      message: content,
      access_token: accessToken,
    });

    if (imageUrl) {
      params.append('url', imageUrl);
    }

    // Post to Facebook
    const endpoint = imageUrl
      ? `https://graph.facebook.com/v18.0/${pageId}/photos`
      : `https://graph.facebook.com/v18.0/${pageId}/feed`;

    const response = await fetch(endpoint, {
      method: 'POST',
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Facebook API error:', data);
      return {
        success: false,
        error: data.error?.message || 'Failed to post to Facebook',
      };
    }

    // Get the post URL
    const postId = data.id || data.post_id;
    const postUrl = postId ? `https://facebook.com/${postId}` : undefined;

    return {
      success: true,
      postId,
      url: postUrl,
    };
  } catch (error) {
    console.error('Error publishing to Facebook:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function getFacebookPages(accessToken: string) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch Facebook pages');
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching Facebook pages:', error);
    return [];
  }
}

export async function getFacebookPageAccessToken(
  userAccessToken: string,
  pageId: string
) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=access_token&access_token=${userAccessToken}`
    );

    if (!response.ok) {
      throw new Error('Failed to get page access token');
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Error getting page access token:', error);
    return null;
  }
}
