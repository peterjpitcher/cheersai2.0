/**
 * Facebook publishing adapter (PLAT-02).
 * Implements PublishingAdapter for Facebook Graph API.
 * Supports: instant_post, story, event, promotion.
 */

import type { PublishingAdapter } from '@/lib/providers/types';
import type { ContentPayload, PublishResult, ValidationResult } from '@/types/providers';
import { getDecryptedToken } from '@/lib/providers/token-helpers';
import { getConnectionMetadata } from '@/lib/providers/shared';
import { validateFacebookContent } from './validation';
import { publishPagePost, publishPagePhoto, publishPageStory } from './api';

export class FacebookAdapter implements PublishingAdapter {
  readonly platform = 'facebook' as const;

  /**
   * Check whether this adapter supports the given content type.
   * Facebook supports feed posts, stories, events, and promotions.
   */
  supports(contentType: string): boolean {
    return ['instant_post', 'story', 'event', 'promotion'].includes(contentType);
  }

  /**
   * Validate content before publishing to Facebook.
   * Returns field-specific errors per D-07 validation spec.
   */
  validate(content: ContentPayload): ValidationResult {
    return validateFacebookContent(content);
  }

  /**
   * Publish a post to a Facebook page.
   * Routes to /feed for text-only or /photos for image posts.
   */
  async publishPost(connectionId: string, content: ContentPayload): Promise<PublishResult> {
    const token = await getDecryptedToken(connectionId, 'access');
    const metadata = await getConnectionMetadata(connectionId);
    const pageId = metadata.pageId as string;

    // Photo post: use /photos endpoint with first image
    if (content.mediaUrls && content.mediaUrls.length > 0) {
      const response = await publishPagePhoto(pageId, token, content.mediaUrls[0], content.text);
      return { platformPostId: response.id };
    }

    // Text-only post: use /feed endpoint
    const response = await publishPagePost(pageId, token, content.text);
    return { platformPostId: response.id };
  }

  /**
   * Publish a story to a Facebook page.
   * Uses /{page-id}/photo_stories endpoint with first media URL.
   */
  async publishStory(connectionId: string, content: ContentPayload): Promise<PublishResult> {
    const token = await getDecryptedToken(connectionId, 'access');
    const metadata = await getConnectionMetadata(connectionId);
    const pageId = metadata.pageId as string;

    const imageUrl = content.mediaUrls![0];
    const response = await publishPageStory(pageId, token, imageUrl);
    return { platformPostId: response.id };
  }
}
