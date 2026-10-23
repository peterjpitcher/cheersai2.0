// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { ProviderPublishRequest, ProviderPublishResult } from "./types.ts";
import { MetaGraphApiError } from "./meta-error.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const IMAGE_CONTAINER_PUBLISH_DELAY_MS = Number(Deno.env.get("INSTAGRAM_IMAGE_CONTAINER_PUBLISH_DELAY_MS") ?? 5000);
const PUBLISH_RETRY_DELAY_MS = Number(Deno.env.get("INSTAGRAM_PUBLISH_RETRY_DELAY_MS") ?? 5000);
const PUBLISH_MAX_ATTEMPTS = Number(Deno.env.get("INSTAGRAM_PUBLISH_MAX_ATTEMPTS") ?? 3);

export async function publishToInstagram({
  payload,
  auth,
  connectionMetadata,
  placement,
}: ProviderPublishRequest): Promise<ProviderPublishResult> {
  if (!auth.accessToken) {
    throw new Error("Missing Instagram access token");
  }

  if (!payload.media.length) {
    throw new Error("Instagram requires an image attachment for publishing");
  }

  const image = payload.media[0];
  if (image.mediaType !== "image") {
    throw new Error("Instagram publishing currently supports images only");
  }

  const igBusinessId = typeof connectionMetadata?.igBusinessId === "string"
    ? connectionMetadata.igBusinessId
    : "";
  if (!igBusinessId) {
    throw new Error("Instagram igBusinessId metadata missing");
  }

  const caption = placement === "story" ? "" : payload.body.trim();
  // Feed posts carry the venue's location, a Facebook Page with location data (B5,
  // tasks/SPEC-instagram-location-tag.md). Stories are left as they are.
  const locationId = placement === "story" ? "" : validLocationId(payload.locationPageId);

  const createUrl = `${GRAPH_BASE}/${igBusinessId}/media`;
  const createParams = new URLSearchParams({
    image_url: image.url,
    access_token: auth.accessToken,
  });

  if (placement === "story") {
    createParams.set("media_type", "STORIES");
  } else if (caption) {
    createParams.set("caption", caption);
  }
  if (locationId) {
    createParams.set("location_id", locationId);
  }

  let createResponse = await fetch(createUrl, {
    method: "POST",
    body: createParams,
  });

  let createJson = await safeJson(createResponse);
  if (!createResponse.ok && locationId && isLocationRefused(createJson)) {
    // A location Instagram will not accept must never stop the post: one more try without it.
    console.warn("[instagram] location tag refused; publishing without it", {
      status: createResponse.status,
      ...graphErrorSummary(createJson),
    });
    createParams.delete("location_id");
    createResponse = await fetch(createUrl, {
      method: "POST",
      body: createParams,
    });
    createJson = await safeJson(createResponse);
  }
  if (!createResponse.ok) {
    throw new MetaGraphApiError(createResponse.status, createJson, "instagram_create_container");
  }

  const creationId = createJson?.id;
  if (typeof creationId !== "string" || !creationId.length) {
    throw new Error("Instagram response missing creation id");
  }

  const publishUrl = `${GRAPH_BASE}/${igBusinessId}/media_publish`;
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: auth.accessToken,
  });

  if (IMAGE_CONTAINER_PUBLISH_DELAY_MS > 0) {
    await delay(IMAGE_CONTAINER_PUBLISH_DELAY_MS);
  }

  const publishJson = await publishContainerWithRetry(publishUrl, publishParams);

  const externalId = publishJson?.id;
  if (typeof externalId !== "string" || !externalId.length) {
    throw new Error("Instagram publish response missing id");
  }

  return {
    platform: "instagram",
    externalId,
    payloadPreview: placement === "story" ? "Instagram story image" : caption.slice(0, 140),
    publishedAt: new Date().toISOString(),
    rawResponse: publishJson,
  };
}

/** A Page id is a number; anything else is not sent. */
function validLocationId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  return /^\d{5,30}$/.test(id) ? id : "";
}

function graphError(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  return error && typeof error === "object" ? error as Record<string, unknown> : null;
}

/**
 * Whether Instagram refused the container over its location (for example
 * INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID, for a Page without location data).
 * Any field of the error may say so, since Meta's error shapes vary; a false match
 * only costs one more try without the tag.
 */
function isLocationRefused(payload: unknown): boolean {
  const error = graphError(payload);
  if (!error) {
    return false;
  }
  try {
    return /location/i.test(JSON.stringify(error));
  } catch {
    return false;
  }
}

/** What to log about a Graph error: codes and Meta's message only, never the request. */
function graphErrorSummary(payload: unknown) {
  const error = graphError(payload);
  return {
    code: typeof error?.code === "number" ? error.code : null,
    subcode: typeof error?.error_subcode === "number" ? error.error_subcode : null,
    message: typeof error?.message === "string" ? error.message.slice(0, 300) : null,
  };
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function publishContainerWithRetry(publishUrl: string, publishParams: URLSearchParams) {
  const maxAttempts = Math.max(1, PUBLISH_MAX_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const publishResponse = await fetch(publishUrl, {
      method: "POST",
      body: publishParams,
    });
    const publishJson = await safeJson(publishResponse);

    if (publishResponse.ok) {
      return publishJson;
    }

    if (attempt < maxAttempts && isContainerNotReadyError(publishResponse.status, publishJson)) {
      await delay(Math.max(0, PUBLISH_RETRY_DELAY_MS));
      continue;
    }

    throw new MetaGraphApiError(publishResponse.status, publishJson, "instagram_publish_container");
  }

  throw new Error("Instagram media container publish did not complete");
}

function isContainerNotReadyError(status: number, payload: unknown) {
  if (status !== 400 || !payload || typeof payload !== "object") {
    return false;
  }

  const error = "error" in payload && payload.error && typeof payload.error === "object"
    ? payload.error as Record<string, unknown>
    : null;
  if (!error) {
    return false;
  }

  const code = typeof error.code === "number" ? error.code : null;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : null;
  const message = typeof error.message === "string" ? error.message : "";

  return (
    code === 9007 ||
    (code === 100 && subcode === 33) ||
    /media id is not available/i.test(message)
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
