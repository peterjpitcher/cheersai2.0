/**
 * Compose publishable text from structured PlatformCopy per platform.
 *
 * The wizard's generate step shows the user reviewed copy with hashtags,
 * CTA text, and link-in-bio lines. This module assembles those parts into
 * the final body string that gets persisted in content_variants.body and
 * sent to the publish pipeline.
 */

import { stripMarkdown } from '@/lib/utils/markdown';
import type { PlatformCopy, Platform } from '@/types/content';

/** Union of all platform-specific copy shapes */
type PlatformCopyEntry = PlatformCopy[Platform];

/**
 * Compose the full publishable body text for a given platform.
 *
 * - Facebook: body + ctaText + hashtags
 * - Instagram: body + linkInBioLine + hashtags
 * - GBP: body only (CTA is a separate API field stored in preview_data)
 */
export function composePublishBody(
  platform: Platform,
  copy: PlatformCopyEntry,
): string {
  const parts: string[] = [stripMarkdown(copy.body)];

  if (platform === 'facebook') {
    const fb = copy as PlatformCopy['facebook'];
    if (fb.ctaText?.trim()) parts.push(fb.ctaText.trim());
    if (fb.hashtags?.length) parts.push(fb.hashtags.join(' '));
  }

  if (platform === 'instagram') {
    const ig = copy as PlatformCopy['instagram'];
    if (ig.linkInBioLine?.trim()) parts.push(ig.linkInBioLine.trim());
    if (ig.hashtags?.length) parts.push(ig.hashtags.join(' '));
  }

  // GBP: body only — ctaAction is a separate API field stored in preview_data

  return parts.join('\n\n');
}

/**
 * Build the preview_data JSONB payload for a content variant.
 * Stores the full structured copy for audit/edit fidelity, plus
 * optional slot context for the publishing pipeline.
 */
export function buildPreviewData(
  platform: Platform,
  copy: PlatformCopyEntry,
  slotContext?: { slotLabel?: string; slotKey?: string; brief?: Record<string, unknown> },
): Record<string, unknown> {
  return {
    structuredCopy: copy,
    platform,
    ...(slotContext ?? {}),
  };
}
