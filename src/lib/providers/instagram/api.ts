/**
 * Instagram Content Publishing API functions (two-step + carousel).
 * Low-level HTTP wrappers for the Instagram Graph API media endpoints.
 * All functions classify errors via classifyMetaError and throw ProviderError.
 */

import { getMetaGraphApiBase } from '@/lib/meta/graph';
import { ProviderError, classifyMetaError } from '@/lib/providers/errors';

/**
 * Handle a non-OK Instagram API response by classifying the error
 * and throwing a ProviderError with the correct classification.
 */
async function handleErrorResponse(response: Response): Promise<never> {
  const errorPayload = await response.json().catch(() => ({}));
  const classification = classifyMetaError(response.status, errorPayload);
  const message = (errorPayload as { error?: { message?: string } })?.error?.message
    ?? `Instagram API error: ${response.status}`;

  throw new ProviderError(
    message,
    'instagram',
    classification,
    classification === 'rate_limit' || classification === 'transient',
    classification === 'rate_limit' ? 60_000 : undefined,
    errorPayload,
  );
}

/**
 * Create a media container for a single-image post or story.
 * POST /{ig-user-id}/media with { image_url, caption, access_token, media_type? }
 *
 * For carousel containers: omit image_url, set mediaType='CAROUSEL', pass children array.
 */
export async function createMediaContainer(
  igUserId: string,
  accessToken: string,
  params: {
    imageUrl?: string;
    caption?: string;
    mediaType?: 'STORIES' | 'CAROUSEL';
    children?: string[];
  },
): Promise<{ id: string }> {
  const url = `${getMetaGraphApiBase()}/${igUserId}/media`;

  const body: Record<string, unknown> = {
    access_token: accessToken,
  };

  if (params.imageUrl) {
    body.image_url = params.imageUrl;
  }
  if (params.caption) {
    body.caption = params.caption;
  }
  if (params.mediaType) {
    body.media_type = params.mediaType;
  }
  if (params.children) {
    body.children = params.children;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) await handleErrorResponse(response);
  return response.json() as Promise<{ id: string }>;
}

/**
 * Publish a previously created media container.
 * POST /{ig-user-id}/media_publish with { creation_id, access_token }
 */
export async function publishMediaContainer(
  igUserId: string,
  accessToken: string,
  containerId: string,
): Promise<{ id: string }> {
  const url = `${getMetaGraphApiBase()}/${igUserId}/media_publish`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  });

  if (!response.ok) await handleErrorResponse(response);
  return response.json() as Promise<{ id: string }>;
}

/**
 * Create a child container for carousel items.
 * POST /{ig-user-id}/media with { image_url, is_carousel_item: true, access_token }
 */
export async function createCarouselChildContainer(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
): Promise<{ id: string }> {
  const url = `${getMetaGraphApiBase()}/${igUserId}/media`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: accessToken,
    }),
  });

  if (!response.ok) await handleErrorResponse(response);
  return response.json() as Promise<{ id: string }>;
}
