/**
 * GBP (Google Business Profile) publishing adapter (PLAT-04).
 * Supports Standard, Event, and Offer post types.
 * Uses just-in-time token refresh for 1-hour access token TTL.
 */

import type { PublishingAdapter, GbpExtensions } from '@/lib/providers/types';
import type { ProviderPlatform, ContentPayload, PublishResult, ValidationResult } from '@/types/providers';
import { validateGbpContent } from '@/lib/providers/gbp/validation';
import { ensureFreshGbpToken } from '@/lib/providers/gbp/token-refresh';
import { publishLocalPost, parseIsoToGbpDate } from '@/lib/providers/gbp/api';
import { getConnectionMetadata } from '@/lib/providers/shared';

/**
 * GBP adapter implementing PublishingAdapter + GbpExtensions.
 * Handles Standard posts, Events, and Offers via the Local Posts API.
 *
 * IMPORTANT: getConnectionMetadata is from Plan 01's shared.ts --
 * do NOT create a local duplicate.
 */
export class GbpAdapter implements PublishingAdapter, GbpExtensions {
  readonly platform: ProviderPlatform = 'gbp';

  supports(contentType: string): boolean {
    return ['instant_post', 'event', 'promotion'].includes(contentType);
  }

  validate(content: ContentPayload): ValidationResult {
    return validateGbpContent(content);
  }

  async publishPost(connectionId: string, content: ContentPayload): Promise<PublishResult> {
    const accessToken = await ensureFreshGbpToken(connectionId);
    const metadata = await getConnectionMetadata(connectionId);
    const locationName = resolveLocalPostParent(metadata);

    const result = await publishLocalPost(locationName, accessToken, {
      languageCode: 'en',
      summary: content.text,
      topicType: 'STANDARD',
      media: content.mediaUrls?.length
        ? content.mediaUrls.map(url => ({ mediaFormat: 'PHOTO' as const, sourceUrl: url }))
        : undefined,
      callToAction: buildCallToAction(content),
    });

    return { platformPostId: result.name };
  }

  async publishEvent(connectionId: string, content: ContentPayload): Promise<PublishResult> {
    const accessToken = await ensureFreshGbpToken(connectionId);
    const metadata = await getConnectionMetadata(connectionId);
    const locationName = resolveLocalPostParent(metadata);
    const details = content.eventDetails!;

    const result = await publishLocalPost(locationName, accessToken, {
      languageCode: 'en',
      summary: content.text,
      topicType: 'EVENT',
      event: {
        title: details.title,
        schedule: {
          startDate: parseIsoToGbpDate(details.startDate),
          endDate: parseIsoToGbpDate(details.endDate),
        },
      },
      media: content.mediaUrls?.length
        ? content.mediaUrls.map(url => ({ mediaFormat: 'PHOTO' as const, sourceUrl: url }))
        : undefined,
      callToAction: buildCallToAction(content),
    });

    return { platformPostId: result.name };
  }

  async publishOffer(connectionId: string, content: ContentPayload): Promise<PublishResult> {
    const accessToken = await ensureFreshGbpToken(connectionId);
    const metadata = await getConnectionMetadata(connectionId);
    const locationName = resolveLocalPostParent(metadata);
    const details = content.offerDetails!;

    const result = await publishLocalPost(locationName, accessToken, {
      languageCode: 'en',
      summary: content.text,
      topicType: 'OFFER',
      offer: {
        couponCode: details.couponCode,
        redeemOnlineUrl: details.redeemUrl,
        termsConditions: details.terms,
      },
      media: content.mediaUrls?.length
        ? content.mediaUrls.map(url => ({ mediaFormat: 'PHOTO' as const, sourceUrl: url }))
        : undefined,
    });

    return { platformPostId: result.name };
  }
}

function resolveLocalPostParent(metadata: Record<string, unknown>): string {
  const localPostParent = getString(metadata.localPostParent);
  if (localPostParent && /^accounts\/[^/]+\/locations\/\d+$/.test(localPostParent)) {
    return localPostParent;
  }

  const legacyLocationId = getString(metadata.locationId);
  if (legacyLocationId && /^accounts\/[^/]+\/locations\/\d+$/.test(legacyLocationId)) {
    return legacyLocationId;
  }

  throw new Error('Google Business Profile connection is missing account-qualified location metadata. Reconnect Google Business Profile.');
}

function buildCallToAction(content: ContentPayload): { actionType: string; url: string } | undefined {
  if (!content.ctaUrl || !/^https?:\/\//i.test(content.ctaUrl)) {
    return undefined;
  }

  return {
    actionType: normaliseActionType(content.ctaAction),
    url: content.ctaUrl,
  };
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

function normaliseActionType(value?: string | null): string {
  const candidate = value?.trim().toUpperCase();
  const allowed = new Set(['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP']);
  return candidate && allowed.has(candidate) ? candidate : 'LEARN_MORE';
}
