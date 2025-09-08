import { createClient } from '@/lib/supabase/server';
import { decryptToken } from '@/lib/security/encryption';

interface LinkedInResponse {
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
}

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
    const postData: any = {
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
    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(postData),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('LinkedIn API error:', error);
      return {
        success: false,
        error: error.message || 'Failed to post to LinkedIn',
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
    console.error('Error publishing to LinkedIn:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function getLinkedInProfile(accessToken: string) {
  try {
    const response = await fetch('https://api.linkedin.com/v2/me', {
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
    console.error('Error fetching LinkedIn profile:', error);
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
    const registerResponse = await fetch(
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
    const imageResponse = await fetch(imageUrl);
    const imageBlob = await imageResponse.blob();

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      body: imageBlob,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image');
    }

    return asset;
  } catch (error) {
    console.error('Error registering LinkedIn image:', error);
    return null;
  }
}
