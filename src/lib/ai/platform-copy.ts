import type { AiGenerationResponse } from '@/lib/ai/schemas';
import type { PlatformCopy } from '@/types/content';

/**
 * Convert the model's snake_case reply to the camelCase PlatformCopy that the
 * wizard shows, the scheduler stores as preview_data.structuredCopy and
 * composePublishBody turns into the published text.
 */
export function toPlatformCopy(raw: AiGenerationResponse): PlatformCopy {
  return {
    facebook: {
      body: raw.facebook.body,
      ctaText: raw.facebook.cta_text ?? undefined,
      hashtags: raw.facebook.hashtags ?? undefined,
    },
    instagram: {
      body: raw.instagram.body,
      hashtags: raw.instagram.hashtags ?? undefined,
      linkInBioLine: raw.instagram.link_in_bio_line ?? undefined,
    },
  };
}
