/**
 * Display helper utilities for content items.
 * Pure functions — no side effects, no DB access.
 */

import type { ContentItem } from '@/types/content';

const MAX_BODY_PREVIEW_LENGTH = 40;

/**
 * Extract a body preview from the bodyDraft JSON blob.
 * Tries facebook, then instagram body text from generatedCopy.
 */
function extractBodyPreview(bodyDraft: Record<string, unknown> | null): string | null {
  if (!bodyDraft) return null;
  const generatedCopy = bodyDraft.generatedCopy as
    | Record<string, Record<string, string>>
    | undefined;
  if (!generatedCopy) return null;
  const raw =
    generatedCopy.facebook?.body ??
    generatedCopy.instagram?.body ??
    null;
  if (!raw || raw.trim().length === 0) return null;
  return raw.trim();
}

/**
 * Return a human-readable display title for a content item.
 *
 * Fallback chain:
 *  1. item.title (if non-empty)
 *  2. item.campaignName (if non-empty)
 *  3. First 40 chars of the first available platform body text
 *  4. 'Untitled'
 */
export function getDisplayTitle(item: ContentItem): string {
  if (item.title && item.title.trim().length > 0) {
    return item.title.trim();
  }

  if (item.campaignName && item.campaignName.trim().length > 0) {
    return item.campaignName.trim();
  }

  const bodyPreview = extractBodyPreview(item.bodyDraft);
  if (bodyPreview) {
    if (bodyPreview.length <= MAX_BODY_PREVIEW_LENGTH) {
      return bodyPreview;
    }
    return `${bodyPreview.slice(0, MAX_BODY_PREVIEW_LENGTH - 1).trimEnd()}…`;
  }

  return 'Untitled';
}
