import { createClient } from '@/lib/supabase/server';
import { encryptToken } from '@/lib/security/encryption';
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'
import { logger } from '@/lib/observability/logger'
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

  private static googleServiceFetch = createServiceFetch('google');
  private static gmbFetch = (url: string, init?: RequestInit) =>
    withRetry(() => GoogleMyBusinessClient.googleServiceFetch(url, init), {
      maxAttempts: 3,
      initialDelay: 500,
      maxDelay: 3000,
    });

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

    const tokenResponse = await GoogleMyBusinessClient.gmbFetch('https://oauth2.googleapis.com/token', {
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

    // Store the new access token in the database (encrypted)
    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    let update = supabase
      .from('social_connections')
      .update({ 
        access_token: null,
        refresh_token: null,
        access_token_encrypted: encryptToken(tokenData.access_token),
        token_encrypted_at: nowIso,
        token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        updated_at: nowIso
      })
      .eq('platform', 'google_my_business');
    if (this.config.tenantId) {
      update = update.eq('tenant_id', this.config.tenantId);
    }
    if (this.config.connectionId) {
      update = update.eq('id', this.config.connectionId);
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
    logger.debug('Exchanging GMB code for tokens', {
      area: 'gmb',
      op: 'token.exchange',
      status: 'pending',
    })
    const response = await GoogleMyBusinessClient.gmbFetch('https://oauth2.googleapis.com/token', {
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
      logger.error('GMB token exchange failed', {
        area: 'gmb',
        op: 'token.exchange',
        status: 'fail',
        meta: { status: response.status },
      })
      throw new Error(`Token exchange failed: ${responseText}`);
    }

    const data = JSON.parse(responseText);
    logger.info('GMB token exchange succeeded', {
      area: 'gmb',
      op: 'token.exchange',
      status: 'ok',
      meta: { hasRefreshToken: Boolean(data.refresh_token) },
    })
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async getAccounts(): Promise<GoogleMyBusinessAccount[]> {
    const accessToken = await this.getAccessToken();
    
    logger.debug('Fetching GMB accounts', {
      area: 'gmb',
      op: 'accounts.list',
      status: 'pending',
    })
    const response = await GoogleMyBusinessClient.gmbFetch(`${this.accountManagementUrl}/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-GOOG-API-FORMAT-VERSION': '2', // Enable detailed error messages
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Failed to fetch GMB accounts', {
        area: 'gmb',
        op: 'accounts.list',
        status: 'fail',
        meta: { status: response.status, error: errorText.slice(0, 200) },
      })
      throw new Error(`Failed to fetch Google Business Profile accounts: ${errorText}`);
    }

    const data = await response.json();
    logger.debug('Fetched GMB accounts', {
      area: 'gmb',
      op: 'accounts.list',
      status: 'ok',
      meta: { count: data.accounts?.length || 0 },
    })
    return data.accounts || [];
  }

  async getLocations(accountName: string): Promise<GoogleMyBusinessLocation[]> {
    const accessToken = await this.getAccessToken();

    const parent = accountName.startsWith('accounts/') ? accountName : `accounts/${accountName}`;

    const url = new URL(`${this.baseUrl}/${parent}/locations`);
    url.searchParams.set('readMask', 'name,title,locationName,storeCode,metadata,profile,locationState');

    logger.debug('Fetching GMB locations', {
      area: 'gmb',
      op: 'locations.list',
      status: 'pending',
      meta: { account: parent },
    })
    const response = await GoogleMyBusinessClient.gmbFetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-GOOG-API-FORMAT-VERSION': '2',
      },
    })

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Failed to fetch GMB locations', {
        area: 'gmb',
        op: 'locations.list',
        status: 'fail',
        meta: { status: response.status, error: errorText.slice(0, 200) },
      })
      throw new Error(`Failed to fetch locations: ${errorText}`);
    }

    const data = await response.json();
    logger.debug('Fetched GMB locations', {
      area: 'gmb',
      op: 'locations.list',
      status: 'ok',
      meta: { count: data.locations?.length || 0 },
    })
    return data.locations || [];
  }

  async createPost(
    accountId: string,
    locationId: string,
    post: GoogleMyBusinessPost
  ): Promise<GoogleMyBusinessResponse> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await GoogleMyBusinessClient.gmbFetch(
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
        logger.warn('GMB post creation failed', {
          area: 'gmb',
          op: 'post.create',
          status: 'fail',
          meta: { accountId, locationId, status: response.status },
        })
        return {
          success: false,
          error: error.error?.message || 'Failed to create post',
          details: error,
        };
      }

      const data = await response.json();
      logger.info('GMB post created', {
        area: 'gmb',
        op: 'post.create',
        status: 'ok',
        meta: { accountId, locationId },
      })
      return {
        success: true,
        postId: data.name,
        name: data.name,
        state: data.state,
        searchUrl: data.searchUrl,
      };
    } catch (error) {
      logger.error('Error publishing to Google Business Profile', {
        area: 'gmb',
        op: 'post.create',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
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
      
      const response = await GoogleMyBusinessClient.gmbFetch(
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
        logger.warn('GMB post deletion failed', {
          area: 'gmb',
          op: 'post.delete',
          status: 'fail',
          meta: { accountId, locationId, postId, status: response.status },
        })
        return {
          success: false,
          error: error.error?.message || 'Failed to delete post',
        };
      }

      logger.info('GMB post deleted', {
        area: 'gmb',
        op: 'post.delete',
        status: 'ok',
        meta: { accountId, locationId, postId },
      })

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Error deleting GMB post', {
        area: 'gmb',
        op: 'post.delete',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
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
    
    const response = await GoogleMyBusinessClient.gmbFetch(
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
      const errorText = await response.text();
      logger.error('Failed to fetch GMB insights', {
        area: 'gmb',
        op: 'insights.fetch',
        status: 'fail',
        meta: { status: response.status, error: errorText.slice(0, 200) },
      })
      throw new Error('Failed to fetch insights');
    }

    return await response.json();
  }

  async getReviews(
    accountId: string,
    locationId: string
  ): Promise<GoogleMyBusinessReview[]> {
    const accessToken = await this.getAccessToken();
    
    const response = await GoogleMyBusinessClient.gmbFetch(
      `${this.baseUrl}/accounts/${accountId}/locations/${locationId}/reviews`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Failed to fetch GMB reviews', {
        area: 'gmb',
        op: 'reviews.list',
        status: 'fail',
        meta: { status: response.status, error: errorText.slice(0, 200) },
      })
      throw new Error('Failed to fetch reviews');
    }

    const data = await response.json();
    logger.debug('Fetched GMB reviews', {
      area: 'gmb',
      op: 'reviews.list',
      status: 'ok',
      meta: { count: data.reviews?.length || 0 },
    })
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
      
      const response = await GoogleMyBusinessClient.gmbFetch(
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
        logger.warn('Failed to reply to GMB review', {
          area: 'gmb',
          op: 'reviews.reply',
          status: 'fail',
          meta: { accountId, locationId, reviewId, status: response.status },
        })
        return {
          success: false,
          error: error.error?.message || 'Failed to reply to review',
        };
      }

      logger.info('Replied to GMB review', {
        area: 'gmb',
        op: 'reviews.reply',
        status: 'ok',
        meta: { accountId, locationId, reviewId },
      })

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Error replying to GMB review', {
        area: 'gmb',
        op: 'reviews.reply',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
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

    // Get Google Business Profile credentials from database (unified social_connections)
    const supabase = await createClient();
    const { data: account, error } = await supabase
      .from('social_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('platform', 'google_my_business')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !account) {
      return {
        success: false,
        error: 'Google Business Profile account not connected',
      };
    }

    type SocialConnection = {
      refresh_token?: string | null
      refresh_token_encrypted?: string | null
      access_token?: string | null
      access_token_encrypted?: string | null
    }

    const connection = account as SocialConnection

    const accountId = typeof account.account_id === 'string' ? account.account_id : null
    const locationId = typeof account.location_id === 'string' ? account.location_id : null

    if (!accountId || !locationId) {
      return {
        success: false,
        error: 'Google Business Profile account is missing location details',
      };
    }

    const client = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-my-business/callback`,
      refreshToken: connection.refresh_token_encrypted ?? connection.refresh_token ?? undefined,
      accessToken: connection.access_token_encrypted ?? connection.access_token ?? undefined,
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
      accountId,
      locationId,
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
    logger.error('Error publishing to Google Business Profile', {
      area: 'gmb',
      op: 'post.publishImmediate',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
