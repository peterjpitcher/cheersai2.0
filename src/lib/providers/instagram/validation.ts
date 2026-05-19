/**
 * Instagram-specific content validation rules (per D-07).
 * Validates content payloads before publishing via Content Publishing API.
 */

import type { ContentPayload, ValidationResult } from '@/types/providers';

/** Instagram maximum caption length */
const IG_MAX_CAPTION_LENGTH = 2200;

/** Instagram maximum hashtags per post */
const IG_MAX_HASHTAGS = 30;

/** Instagram carousel minimum items */
const IG_CAROUSEL_MIN = 2;

/** Instagram carousel maximum items */
const IG_CAROUSEL_MAX = 10;

/**
 * Count the number of hashtags in a text string.
 * Matches # followed by at least one word character.
 */
function countHashtags(text: string): number {
  const matches = text.match(/#\w+/g);
  return matches ? matches.length : 0;
}

/**
 * Validate a ContentPayload for Instagram publishing.
 * Returns field-specific error codes for each violation.
 */
export function validateInstagramContent(content: ContentPayload): ValidationResult {
  const errors: ValidationResult['errors'] = [];

  // Caption length check applies to all content types
  if (content.text && content.text.length > IG_MAX_CAPTION_LENGTH) {
    errors.push({
      field: 'text',
      message: `Caption exceeds Instagram maximum of ${IG_MAX_CAPTION_LENGTH} characters`,
      code: 'IG_CAPTION_TOO_LONG',
    });
  }

  // Hashtag limit (applies to all types with text)
  if (content.text && countHashtags(content.text) > IG_MAX_HASHTAGS) {
    errors.push({
      field: 'text',
      message: `Instagram allows a maximum of ${IG_MAX_HASHTAGS} hashtags per post`,
      code: 'IG_TOO_MANY_HASHTAGS',
    });
  }

  // Feed posts require at least one media URL
  if (content.contentType === 'instant_post') {
    if (!content.mediaUrls || content.mediaUrls.length === 0) {
      errors.push({
        field: 'mediaUrls',
        message: 'Instagram feed posts require at least one image',
        code: 'IG_POST_NO_MEDIA',
      });
    }
  }

  // Story requires at least one media URL
  if (content.contentType === 'story') {
    if (!content.mediaUrls || content.mediaUrls.length === 0) {
      errors.push({
        field: 'mediaUrls',
        message: 'Instagram stories require at least one image',
        code: 'IG_STORY_NO_MEDIA',
      });
    }
  }

  // Carousel requires 2-10 media URLs
  if (content.contentType === 'carousel') {
    const count = content.mediaUrls?.length ?? 0;
    if (count < IG_CAROUSEL_MIN) {
      errors.push({
        field: 'mediaUrls',
        message: `Instagram carousels require at least ${IG_CAROUSEL_MIN} images`,
        code: 'IG_CAROUSEL_TOO_FEW',
      });
    }
    if (count > IG_CAROUSEL_MAX) {
      errors.push({
        field: 'mediaUrls',
        message: `Instagram carousels allow a maximum of ${IG_CAROUSEL_MAX} images`,
        code: 'IG_CAROUSEL_TOO_MANY',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
