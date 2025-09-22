import { createClient } from '@/lib/supabase/server';
import { decryptToken } from '@/lib/security/encryption';
import { createServiceFetch } from '@/lib/reliability/timeout';
import { withRetry } from '@/lib/reliability/retry';
import { assertIsPublicSupabaseMediaUrl } from '@/lib/storage/validation';
import { logger } from '@/lib/observability/logger';

interface LinkedInResponse {
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
}

const linkedinServiceFetch = createServiceFetch('linkedin');
const storageServiceFetch = createServiceFetch('storage');

const linkedinFetch = (url: string, init?: RequestInit) =>
  withRetry(() => linkedinServiceFetch(url, init), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 2000,
  });

const storageFetch = (url: string) =>
  withRetry(() => storageServiceFetch(url), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 2000,
  });

export async function publishToLinkedIn(
  content: string,
  imageUrl?: string,
  tenantId?: string
): Promise<LinkedInResponse> {
  try {
    if (!tenantId) {
      return {
        success: false,
        error: 'Tenant ID is required',
      };
    }

    // Get LinkedIn credentials from database (unified social_connections)
    const supabase = await createClient();
    const { data: account, error } = await supabase
      .from('social_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('platform', 'linkedin')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !account) {
      return {
        success: false,
        error: 'LinkedIn account not connected',
      };
    }

    const accessToken = account.access_token_encrypted
      ? decryptToken(account.access_token_encrypted)
      : account.access_token;
    const profileId = account.account_id; // Use account_id for owner URN

    if (!accessToken || !profileId) {
      return {
        success: false,
        error: 'Invalid LinkedIn credentials',
      };
    }

    // Build the post data
    type LinkedInMedia = {
      status: 'READY'
      description: { text: string }
      media: string
      title: { text: string }
    }

    type LinkedInPostPayload = {
      author: string
      lifecycleState: 'PUBLISHED'
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: string }
          shareMediaCategory: 'IMAGE' | 'NONE'
          media?: LinkedInMedia[]
        }
      }
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    }

    const postData: LinkedInPostPayload = {
      author: `urn:li:person:${profileId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: content,
          },
          shareMediaCategory: imageUrl ? 'IMAGE' : 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };

    // Add image if provided
    if (imageUrl) {
      try {
        assertIsPublicSupabaseMediaUrl(imageUrl);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Invalid image URL',
        };
      }
      // In production, you'd register the image with LinkedIn first
      postData.specificContent['com.linkedin.ugc.ShareContent'].media = [
        {
          status: 'READY',
          description: {
            text: 'Image description',
          },
          media: imageUrl,
          title: {
            text: 'Image title',
          },
        },
      ];
    }

    // Post to LinkedIn
    const response = await linkedinFetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(postData),
    });

    if (!response.ok) {
      let errorBody: unknown = null;
      try { errorBody = await response.json(); } catch {}
      const logError =
        errorBody instanceof Error
          ? errorBody
          : errorBody
            ? new Error(typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody))
            : undefined
      logger.warn('LinkedIn publish failed', {
        area: 'linkedin',
        op: 'publish',
        status: 'fail',
        error: logError,
      });
      return {
        success: false,
        error: (errorBody as { message?: string })?.message || 'Failed to post to LinkedIn',
      };
    }

    const data = await response.json();
    const postId = data.id;

    return {
      success: true,
      postId,
      url: postId ? `https://www.linkedin.com/feed/update/${postId}` : undefined,
    };
  } catch (error) {
    logger.error('LinkedIn publish threw', {
      area: 'linkedin',
      op: 'publish',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function getLinkedInProfile(accessToken: string) {
  try {
    const response = await linkedinFetch('https://api.linkedin.com/v2/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch LinkedIn profile');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error('LinkedIn profile fetch failed', {
      area: 'linkedin',
      op: 'profile.fetch',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}

export async function registerLinkedInImage(
  imageUrl: string,
  accessToken: string,
  profileId: string
): Promise<string | null> {
  try {
    // Register upload
    const registerResponse = await linkedinFetch(
      'https://api.linkedin.com/v2/assets?action=registerUpload',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: `urn:li:person:${profileId}`,
            serviceRelationships: [
              {
                relationshipType: 'OWNER',
                identifier: 'urn:li:userGeneratedContent',
              },
            ],
          },
        }),
      }
    );

    if (!registerResponse.ok) {
      throw new Error('Failed to register image upload');
    }

    const registerData = await registerResponse.json();
    const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = registerData.value.asset;

    // Download and upload the image
    assertIsPublicSupabaseMediaUrl(imageUrl);
    const imageResponse = await storageFetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error('Failed to download image asset');
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    const uploadResponse = await linkedinFetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image');
    }

    return asset;
  } catch (error) {
    logger.error('LinkedIn image registration failed', {
      area: 'linkedin',
      op: 'image.register',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}
