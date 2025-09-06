import { createClient } from '@/lib/supabase/server';
import {
  GoogleMyBusinessConfig,
  GoogleMyBusinessPost,
  GoogleMyBusinessResponse,
  GoogleMyBusinessAccount,
  GoogleMyBusinessLocation,
  GoogleMyBusinessMetrics,
  GoogleMyBusinessInsights,
  GoogleMyBusinessReview,
} from './types';

export class GoogleMyBusinessClient {
  private config: GoogleMyBusinessConfig;
  private baseUrl = 'https://mybusinessbusinessinformation.googleapis.com/v1';
  private accountManagementUrl = 'https://mybusinessaccountmanagement.googleapis.com/v1';
  private performanceUrl = 'https://businessprofileperformance.googleapis.com/v1';

  constructor(config: GoogleMyBusinessConfig) {
    this.config = config;
  }

  private async getAccessToken(): Promise<string> {
    if (this.config.accessToken && this.isTokenValid()) {
      return this.config.accessToken;
    }

    if (!this.config.refreshToken) {
      throw new Error('No refresh token available');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to refresh access token');
    }

    const tokenData = await tokenResponse.json();
    this.config.accessToken = tokenData.access_token;

    // Store the new access token in the database
    const supabase = await createClient();
    let update = supabase
      .from('social_accounts')
      .update({ 
        access_token: tokenData.access_token,
        token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      })
      .eq('platform', 'google_my_business')
      .eq('refresh_token', this.config.refreshToken);
    if (this.config.tenantId) {
      update = update.eq('tenant_id', this.config.tenantId);
    }
    await update;

    return tokenData.access_token;
  }

  private isTokenValid(): boolean {
    // Simple check - in production, store and check token expiry
    return !!this.config.accessToken;
  }

  async getAuthorizationUrl(state: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      // Use only the business.manage scope as per Google's current documentation
      // Do NOT use plus.business.manage (Google+ deprecated) or businesscommunications
      scope: 'https://www.googleapis.com/auth/business.manage',
      access_type: 'offline',
      prompt: 'consent', // Ensure refresh token on first connect
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    console.log('GMB API: Exchanging code for tokens');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error('GMB API: Token exchange failed:', responseText);
      throw new Error(`Token exchange failed: ${responseText}`);
    }

    const data = JSON.parse(responseText);
    console.log('GMB API: Token exchange successful, got refresh token:', !!data.refresh_token);
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async getAccounts(): Promise<GoogleMyBusinessAccount[]> {
    const accessToken = await this.getAccessToken();
    
    // Minimal logging to avoid noisy payloads in production
    if (process.env.NODE_ENV !== 'production') {
      console.log('GMB API: Fetching accounts from:', `${this.accountManagementUrl}/accounts`);
    }
    const response = await fetch(`${this.accountManagementUrl}/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-GOOG-API-FORMAT-VERSION': '2', // Enable detailed error messages
      },
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('GMB API: Account response status:', response.status);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('GMB API: Account fetch error:', errorText);
      throw new Error(`Failed to fetch Google My Business accounts: ${errorText}`);
    }

    const data = await response.json();
    if (process.env.NODE_ENV !== 'production') {
      console.log('GMB API: Account data keys:', Object.keys(data || {}));
    }
    return data.accounts || [];
  }

  async getLocations(accountName: string): Promise<GoogleMyBusinessLocation[]> {
    const accessToken = await this.getAccessToken();
    
    // Use the account resource name (e.g., "accounts/123456")
    // If passed a bare ID, prepend "accounts/"
    const parent = accountName.startsWith('accounts/') ? accountName : `accounts/${accountName}`;
    
    // Build URL with required readMask parameter
    const url = new URL(`${this.baseUrl}/${parent}/locations`);
    url.searchParams.set('readMask', 'name,title,locationName,storeCode,metadata,profile,locationState');
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('GMB API: Fetching locations from:', url.toString());
    }
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-GOOG-API-FORMAT-VERSION': '2', // Enable detailed error messages
      },
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('GMB API: Locations response status:', response.status);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('GMB API: Locations fetch error:', errorText);
      throw new Error(`Failed to fetch locations: ${errorText}`);
    }

    const data = await response.json();
    if (process.env.NODE_ENV !== 'production') {
      console.log('GMB API: Locations data keys:', Object.keys(data || {}));
    }
    return data.locations || [];
  }

  async createPost(
    accountId: string,
    locationId: string,
    post: GoogleMyBusinessPost
  ): Promise<GoogleMyBusinessResponse> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(
        `${this.baseUrl}/accounts/${accountId}/locations/${locationId}/localPosts`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            languageCode: 'en-GB',
            ...post,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          error: error.error?.message || 'Failed to create post',
          details: error,
        };
      }

      const data = await response.json();
      return {
        success: true,
        postId: data.name,
        name: data.name,
        state: data.state,
        searchUrl: data.searchUrl,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async deletePost(
    accountId: string,
    locationId: string,
    postId: string
  ): Promise<GoogleMyBusinessResponse> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(
        `${this.baseUrl}/accounts/${accountId}/locations/${locationId}/localPosts/${postId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          error: error.error?.message || 'Failed to delete post',
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async getInsights(
    accountId: string,
    locationId: string,
    metrics: GoogleMyBusinessMetrics
  ): Promise<GoogleMyBusinessInsights> {
    const accessToken = await this.getAccessToken();
    
    const response = await fetch(
      `${this.performanceUrl}/locations/${locationId}:fetchMultiDailyMetricsTimeSeries`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dailyMetrics: metrics.metricRequests.map(req => req.metric),
          dailyRange: {
            startDate: {
              year: new Date(metrics.timeRange.startTime).getFullYear(),
              month: new Date(metrics.timeRange.startTime).getMonth() + 1,
              day: new Date(metrics.timeRange.startTime).getDate(),
            },
            endDate: {
              year: new Date(metrics.timeRange.endTime).getFullYear(),
              month: new Date(metrics.timeRange.endTime).getMonth() + 1,
              day: new Date(metrics.timeRange.endTime).getDate(),
            },
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch insights');
    }

    return await response.json();
  }

  async getReviews(
    accountId: string,
    locationId: string
  ): Promise<GoogleMyBusinessReview[]> {
    const accessToken = await this.getAccessToken();
    
    const response = await fetch(
      `${this.baseUrl}/accounts/${accountId}/locations/${locationId}/reviews`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch reviews');
    }

    const data = await response.json();
    return data.reviews || [];
  }

  async replyToReview(
    accountId: string,
    locationId: string,
    reviewId: string,
    comment: string
  ): Promise<GoogleMyBusinessResponse> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await fetch(
        `${this.baseUrl}/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}/reply`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            comment,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          error: error.error?.message || 'Failed to reply to review',
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}

export async function publishToGoogleMyBusiness(
  content: string,
  imageUrl?: string,
  tenantId?: string,
  callToAction?: GoogleMyBusinessPost['callToAction'],
  topicType: GoogleMyBusinessPost['topicType'] = 'STANDARD'
): Promise<GoogleMyBusinessResponse> {
  try {
    if (!tenantId) {
      return {
        success: false,
        error: 'Tenant ID is required',
      };
    }

    // Get Google My Business credentials from database
    const supabase = await createClient();
    const { data: account, error } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('platform', 'google_my_business')
      .single();

    if (error || !account) {
      return {
        success: false,
        error: 'Google My Business account not connected',
      };
    }

    const client = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-my-business/callback`,
      refreshToken: account.refresh_token,
      accessToken: account.access_token,
    });

    // Build the post
    const post: GoogleMyBusinessPost = {
      summary: content,
      topicType,
    };

    if (imageUrl) {
      post.media = [{
        mediaFormat: 'PHOTO',
        sourceUrl: imageUrl,
      }];
    }

    if (callToAction) {
      post.callToAction = callToAction;
    }

    // Create the post
    const result = await client.createPost(
      account.account_id,
      account.location_id,
      post
    );

    // Log the post
    await supabase.from('social_posts').insert({
      tenant_id: tenantId,
      platform: 'google_my_business',
      content,
      media_url: imageUrl,
      external_id: result.postId,
      status: result.success ? 'published' : 'failed',
      published_at: result.success ? new Date().toISOString() : null,
      error: result.error,
    });

    return result;
  } catch (error) {
    console.error('Error publishing to Google My Business:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
