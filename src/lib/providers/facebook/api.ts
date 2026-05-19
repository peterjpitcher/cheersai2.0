/**
 * Raw Facebook Graph API call functions.
 * Low-level HTTP wrappers for page feed, photo, and story publishing.
 * All functions classify errors via classifyMetaError and throw ProviderError.
 */

import { getMetaGraphApiBase } from '@/lib/meta/graph';
import { ProviderError, classifyMetaError } from '@/lib/providers/errors';

/**
 * Handle a non-OK Graph API response by classifying the error
 * and throwing a ProviderError with the correct classification.
 */
async function handleErrorResponse(response: Response): Promise<never> {
  const errorPayload = await response.json().catch(() => ({}));
  const classification = classifyMetaError(response.status, errorPayload);
  const message = (errorPayload as { error?: { message?: string } })?.error?.message
    ?? `Facebook API error: ${response.status}`;

  throw new ProviderError(
    message,
    'facebook',
    classification,
    classification === 'rate_limit' || classification === 'transient',
    classification === 'rate_limit' ? 60_000 : undefined,
    errorPayload,
  );
}

/**
 * Publish a text-only post to a Facebook page feed.
 * POST /{page-id}/feed with { message, access_token }
 */
export async function publishPagePost(
  pageId: string,
  accessToken: string,
  message: string,
): Promise<{ id: string }> {
  const url = `${getMetaGraphApiBase()}/${pageId}/feed`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: accessToken }),
  });

  if (!response.ok) await handleErrorResponse(response);
  return response.json() as Promise<{ id: string }>;
}

/**
 * Publish a photo post to a Facebook page.
 * POST /{page-id}/photos with { url, caption, access_token }
 */
export async function publishPagePhoto(
  pageId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
): Promise<{ id: string }> {
  const url = `${getMetaGraphApiBase()}/${pageId}/photos`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl, caption, access_token: accessToken }),
  });

  if (!response.ok) await handleErrorResponse(response);
  return response.json() as Promise<{ id: string }>;
}

/**
 * Publish a photo story to a Facebook page.
 * POST /{page-id}/photo_stories with { photo_url, access_token }
 */
export async function publishPageStory(
  pageId: string,
  accessToken: string,
  imageUrl: string,
): Promise<{ id: string }> {
  const url = `${getMetaGraphApiBase()}/${pageId}/photo_stories`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_url: imageUrl, access_token: accessToken }),
  });

  if (!response.ok) await handleErrorResponse(response);
  return response.json() as Promise<{ id: string }>;
}
