/**
 * Compose publishable text from structured PlatformCopy per platform.
 *
 * The wizard's generate step shows the user reviewed copy with hashtags,
 * CTA text, and link-in-bio lines. This module assembles those parts into
 * the final body string that gets persisted in content_variants.body and
 * sent to the publish pipeline.
 */

import type { ContentType, PlatformCopy, Platform, PlatformCtaLinks } from '@/types/content';
import {
  normalizeHashtags,
  resolvePlatformCtaUrl,
  sanitizeCtaText,
  sanitizePublishBody,
} from '@/lib/publishing/copy-rules';

/** Union of all platform-specific copy shapes */
type PlatformCopyEntry = PlatformCopy[Platform];

interface ComposeOptions {
  ctaLinks?: PlatformCtaLinks | null;
  contentType?: ContentType;
}

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
  options: ComposeOptions = {},
): string {
  if (typeof copy.publishBodyOverride === 'string') {
    return copy.publishBodyOverride.replace(/\r\n/g, '\n').trim();
  }

  const body = sanitizePublishBody(platform, copy.body);
  const parts: string[] = body ? [body] : [];
  const ctaUrl = resolvePlatformCtaUrl(platform, options.ctaLinks);

  if (platform === 'facebook') {
    const fb = copy as PlatformCopy['facebook'];
    const ctaText = sanitizeCtaText(fb.ctaText?.trim() || (ctaUrl ? defaultCtaText(options.contentType) : ''));
    if (ctaText && ctaUrl) {
      parts.push(`${ctaText.replace(/[:.!?]+$/g, '')}: ${ctaUrl}`);
    } else if (ctaText) {
      parts.push(ctaText);
    }
    const hashtags = normalizeHashtags(fb.hashtags, 'facebook');
    if (hashtags?.length) parts.push(hashtags.join(' '));
  }

  if (platform === 'instagram') {
    const ig = copy as PlatformCopy['instagram'];
    const linkLine = sanitizeCtaText(ig.linkInBioLine?.trim() || (ctaUrl ? defaultLinkInBioLine(options.contentType) : ''));
    if (linkLine) parts.push(linkLine);
    const hashtags = normalizeHashtags(ig.hashtags, 'instagram');
    if (hashtags?.length) parts.push(hashtags.join(' '));
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
  options: ComposeOptions = {},
): Record<string, unknown> {
  const ctaUrl = resolvePlatformCtaUrl(platform, options.ctaLinks);
  const gbpCopy = platform === 'gbp' ? copy as PlatformCopy['gbp'] : null;

  return {
    structuredCopy: copy,
    platform,
    ...(ctaUrl
      ? {
          ctaUrl,
          cta: {
            url: ctaUrl,
            ...(platform === 'gbp'
              ? { action: normaliseGbpCtaAction(gbpCopy?.ctaAction) }
              : {}),
          },
        }
      : {}),
    ...(slotContext ?? {}),
  };
}

function defaultCtaText(contentType?: ContentType): string {
  switch (contentType) {
    case 'event':
      return 'Book now';
    case 'weekly_recurring':
      return 'Book a table';
    case 'promotion':
    case 'instant_post':
    case 'story':
    default:
      return 'Learn more';
  }
}

function defaultLinkInBioLine(contentType?: ContentType): string {
  switch (contentType) {
    case 'event':
      return 'Link in bio to book';
    case 'weekly_recurring':
      return 'Link in bio to book a table';
    default:
      return 'Details in bio';
  }
}

function normaliseGbpCtaAction(action?: string | null): string {
  const candidate = action?.trim().toUpperCase();
  return candidate && ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP'].includes(candidate)
    ? candidate
    : 'LEARN_MORE';
}
