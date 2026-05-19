/**
 * Instagram publishing adapter (PLAT-03).
 * Implements PublishingAdapter for Instagram Content Publishing API.
 * Supports: instant_post (single-image), story, carousel.
 *
 * Instagram uses a two-step publish flow:
 * 1. Create media container (POST /{ig-user-id}/media)
 * 2. Publish the container (POST /{ig-user-id}/media_publish)
 *
 * Carousels add child container creation before the carousel container.
 */

import type { PublishingAdapter } from '@/lib/providers/types';
import type { ContentPayload, PublishResult, ValidationResult } from '@/types/providers';
import { getDecryptedToken } from '@/lib/providers/token-helpers';
import { getConnectionMetadata } from '@/lib/providers/shared';
import { validateInstagramContent } from './validation';
import {
  createMediaContainer,
  publishMediaContainer,
  createCarouselChildContainer,
} from './api';

export class InstagramAdapter implements PublishingAdapter {
  readonly platform = 'instagram' as const;

  /**
   * Check whether this adapter supports the given content type.
   * Instagram supports feed posts, stories, and carousels.
   * Events and promotions are not natively supported on Instagram.
   */
  supports(contentType: string): boolean {
    return ['instant_post', 'story', 'carousel'].includes(contentType);
  }

  /**
   * Validate content before publishing to Instagram.
   * Returns field-specific errors per D-07 validation spec.
   */
  validate(content: ContentPayload): ValidationResult {
    return validateInstagramContent(content);
  }

  /**
   * Publish a post to Instagram via Content Publishing API.
   *
   * Single-image: standard two-step (create container, publish).
   * Carousel: create child containers for each image, create carousel
   * container with CAROUSEL media type and children array, then publish.
   */
  async publishPost(connectionId: string, content: ContentPayload): Promise<PublishResult> {
    const token = await getDecryptedToken(connectionId, 'access');
    const metadata = await getConnectionMetadata(connectionId);
    const igUserId = metadata.igBusinessId as string;

    // Carousel flow (per PLAT-03)
    if (content.contentType === 'carousel' && content.mediaUrls && content.mediaUrls.length >= 2) {
      // Step 1: Create child containers for each image
      const childIds: string[] = [];
      for (const imageUrl of content.mediaUrls) {
        const child = await createCarouselChildContainer(igUserId, token, imageUrl);
        childIds.push(child.id);
      }

      // Step 2: Create carousel container with CAROUSEL media type and children array
      const carousel = await createMediaContainer(igUserId, token, {
        caption: content.text,
        mediaType: 'CAROUSEL',
        children: childIds,
      });

      // Step 3: Publish the carousel container
      const result = await publishMediaContainer(igUserId, token, carousel.id);
      return { platformPostId: result.id };
    }

    // Single-image flow (standard two-step)
    const container = await createMediaContainer(igUserId, token, {
      imageUrl: content.mediaUrls![0],
      caption: content.text,
    });
    const result = await publishMediaContainer(igUserId, token, container.id);
    return { platformPostId: result.id };
  }

  /**
   * Publish a story to Instagram.
   * Uses two-step flow with media_type=STORIES in the container creation.
   */
  async publishStory(connectionId: string, content: ContentPayload): Promise<PublishResult> {
    const token = await getDecryptedToken(connectionId, 'access');
    const metadata = await getConnectionMetadata(connectionId);
    const igUserId = metadata.igBusinessId as string;

    const container = await createMediaContainer(igUserId, token, {
      imageUrl: content.mediaUrls![0],
      mediaType: 'STORIES',
    });
    const result = await publishMediaContainer(igUserId, token, container.id);
    return { platformPostId: result.id };
  }
}
