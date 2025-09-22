import { createClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/security/encryption'
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'
import { assertIsPublicSupabaseMediaUrl } from '@/lib/storage/validation'
import { logger } from '@/lib/observability/logger'

// Instagram Business API uses the Facebook Graph API
// Instagram accounts must be connected to a Facebook Page

export interface InstagramAccount {
  id: string
  username: string
  profile_picture_url?: string
  followers_count?: number
  media_count?: number
  biography?: string
  website?: string
  ig_id: number
}

export interface InstagramMedia {
  id: string
  caption?: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  media_url?: string
  thumbnail_url?: string
  permalink: string
  timestamp: string
  comments_count?: number
  like_count?: number
}

export interface InstagramPublishParams {
  caption: string
  image_url?: string
  video_url?: string
  media_type?: 'IMAGE' | 'VIDEO' | 'CAROUSEL'
  children?: Array<{ media_url: string; media_type: 'IMAGE' | 'VIDEO' }>
  location_id?: string
  user_tags?: Array<{ username: string; x?: number; y?: number }>
}

const instagramServiceFetch = createServiceFetch('instagram')

const instagramFetch = (url: string, init?: RequestInit) =>
  withRetry(() => instagramServiceFetch(url, init), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 2000,
  })

type JsonRecord = Record<string, unknown> | null

function safeJson(text: string): JsonRecord {
  try {
    return JSON.parse(text) as JsonRecord
  } catch {
    return null
  }
}

function toId(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

export class InstagramClient {
  private accessToken: string
  private instagramAccountId?: string

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  async getConnectedInstagramAccounts(pageId: string): Promise<InstagramAccount[]> {
    try {
      const response = await instagramFetch(
        `https://graph.facebook.com/v23.0/${pageId}?fields=instagram_business_account{id,username,profile_picture_url,followers_count,media_count,biography,website,ig_id}&access_token=${this.accessToken}`
      )

      if (!response.ok) {
        throw new Error(`Failed to get Instagram accounts: ${response.statusText}`)
      }

      const data = await response.json()
      if (!data.instagram_business_account) {
        return []
      }

      return [data.instagram_business_account]
    } catch (error) {
      logger.error('Instagram accounts fetch failed', {
        area: 'instagram',
        op: 'accounts.list',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    }
  }

  setInstagramAccount(accountId: string) {
    this.instagramAccountId = accountId
  }

  async publishToInstagram(params: InstagramPublishParams): Promise<{ id: string; permalink?: string }> {
    if (!this.instagramAccountId) {
      throw new Error('No Instagram account selected')
    }

    try {
      if (params.image_url) {
        assertIsPublicSupabaseMediaUrl(params.image_url)
      }
      if (params.video_url) {
        assertIsPublicSupabaseMediaUrl(params.video_url)
      }
      if (params.children) {
        for (const child of params.children) {
          if (child.media_url) {
            assertIsPublicSupabaseMediaUrl(child.media_url)
          }
        }
      }

      let mediaContainerId: string

      if (params.media_type === 'CAROUSEL') {
        mediaContainerId = await this.createCarouselContainer(params)
      } else if (params.video_url) {
        mediaContainerId = await this.createVideoContainer(params)
      } else if (params.image_url) {
        mediaContainerId = await this.createImageContainer(params)
      } else {
        throw new Error('No media provided for Instagram post')
      }

      const publishResponse = await instagramFetch(
        `https://graph.facebook.com/v23.0/${this.instagramAccountId}/media_publish`,
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
      )

      const publishText = await publishResponse.text()
      const publishData = safeJson(publishText)
      if (!publishResponse.ok || publishData?.error) {
        throw new Error(`Failed to publish to Instagram: ${publishText}`)
      }

      const mediaId = toId(publishData?.id)
      const permalink = mediaId ? await this.getMediaPermalink(mediaId) : ''

      return {
        id: mediaId,
        permalink,
      }
    } catch (error) {
      logger.error('Instagram publish failed', {
        area: 'instagram',
        op: 'publish',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    }
  }

  private async createImageContainer(params: InstagramPublishParams): Promise<string> {
    const response = await instagramFetch(
      `https://graph.facebook.com/v23.0/${this.instagramAccountId}/media`,
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
    )

    const text = await response.text()
    const data = safeJson(text)
    if (!response.ok || data?.error) {
      throw new Error(`Failed to create image container: ${text}`)
    }

    return toId(data?.id)
  }

  private async createVideoContainer(params: InstagramPublishParams): Promise<string> {
    const response = await instagramFetch(
      `https://graph.facebook.com/v23.0/${this.instagramAccountId}/media`,
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
    )

    const text = await response.text()
    const data = safeJson(text)
    if (!response.ok || data?.error) {
      throw new Error(`Failed to create video container: ${text}`)
    }

    const mediaId = toId(data?.id)
    await this.waitForMediaProcessing(mediaId)
    return mediaId
  }

  private async createCarouselContainer(params: InstagramPublishParams): Promise<string> {
    if (!params.children || params.children.length < 2 || params.children.length > 10) {
      throw new Error('Carousel must have between 2 and 10 media items')
    }

    const childIds: string[] = []
    for (const child of params.children) {
      assertIsPublicSupabaseMediaUrl(child.media_url)

      const childResponse = await instagramFetch(
        `https://graph.facebook.com/v23.0/${this.instagramAccountId}/media`,
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
      )

      const childText = await childResponse.text()
      const childData = safeJson(childText)
      if (!childResponse.ok || childData?.error) {
        throw new Error(`Failed to create carousel child: ${childText}`)
      }

      const childId = toId(childData?.id)
      if (child.media_type === 'VIDEO') {
        await this.waitForMediaProcessing(childId)
      }

      childIds.push(childId)
    }

    const response = await instagramFetch(
      `https://graph.facebook.com/v23.0/${this.instagramAccountId}/media`,
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
    )

    const text = await response.text()
    const data = safeJson(text)
    if (!response.ok || data?.error) {
      throw new Error(`Failed to create carousel container: ${text}`)
    }

    return toId(data?.id)
  }

  private async waitForMediaProcessing(containerId: string, maxAttempts: number = 30): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await instagramFetch(
        `https://graph.facebook.com/v23.0/${containerId}?fields=status_code&access_token=${this.accessToken}`
      )

      if (!response.ok) {
        throw new Error('Failed to check media status')
      }

      const data = await response.json()
      if (data.status_code === 'FINISHED') {
        return
      }
      if (data.status_code === 'ERROR') {
        throw new Error('Media processing failed')
      }

      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    throw new Error('Media processing timeout')
  }

  private async getMediaPermalink(mediaId: string): Promise<string> {
    if (!mediaId) return ''
    try {
      const response = await instagramFetch(
        `https://graph.facebook.com/v23.0/${mediaId}?fields=permalink&access_token=${this.accessToken}`
      )

      if (!response.ok) {
        return ''
      }

      const data = await response.json()
      return data.permalink || ''
    } catch (error) {
      logger.warn('Instagram permalink fetch failed', {
        area: 'instagram',
        op: 'media.permalink',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return ''
    }
  }

  async getInstagramInsights(mediaId: string): Promise<InstagramInsightsResponse> {
    try {
      const response = await instagramFetch(
        `https://graph.facebook.com/v23.0/${mediaId}/insights?metric=impressions,reach,engagement&access_token=${this.accessToken}`
      )

      if (!response.ok) {
        throw new Error('Failed to get Instagram insights')
      }

      return await response.json()
    } catch (error) {
      logger.error('Instagram insights fetch failed', {
        area: 'instagram',
        op: 'insights.fetch',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    }
  }

  async getRecentMedia(limit: number = 25): Promise<InstagramMedia[]> {
    if (!this.instagramAccountId) {
      throw new Error('No Instagram account selected')
    }

    try {
      const response = await instagramFetch(
        `https://graph.facebook.com/v23.0/${this.instagramAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=${limit}&access_token=${this.accessToken}`
      )

      if (!response.ok) {
        throw new Error('Failed to get recent media')
      }

      const data = await response.json()
      return data.data || []
    } catch (error) {
      logger.error('Instagram media fetch failed', {
        area: 'instagram',
        op: 'media.list',
        status: 'fail',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    }
  }
}

type InstagramInsightValue = {
  value: number | Record<string, unknown>
  end_time: string
}

type InstagramInsight = {
  name: string
  period: string
  values: InstagramInsightValue[]
}

type InstagramInsightsResponse = {
  data?: InstagramInsight[]
}

export async function publishToInstagram(
  content: string,
  imageUrl?: string,
  tenantId?: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    if (!tenantId) {
      return { success: false, error: 'Tenant ID is required' }
    }

    if (!imageUrl) {
      return { success: false, error: 'Instagram requires an image or video' }
    }

    assertIsPublicSupabaseMediaUrl(imageUrl)

    const supabase = await createClient()
    const { data: account } = await supabase
      .from('social_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('platform', 'instagram_business')
      .eq('is_active', true)
      .single()

    const accessToken = account?.access_token_encrypted
      ? decryptToken(account.access_token_encrypted)
      : account?.access_token

    if (!account || !accessToken) {
      return { success: false, error: 'Instagram account not connected' }
    }

    const client = new InstagramClient(accessToken)
    client.setInstagramAccount(account.account_id)

    const result = await client.publishToInstagram({
      caption: content,
      image_url: imageUrl,
    })

    return {
      success: true,
      postId: result.id,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to publish to Instagram',
    }
  }
}
