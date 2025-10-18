import type { ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

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

  const createResponse = await fetch(createUrl, {
    method: "POST",
    body: createParams,
  });

  const createJson = await safeJson(createResponse);
  if (!createResponse.ok) {
    throw new Error(formatGraphError(createJson));
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

  const publishResponse = await fetch(publishUrl, {
    method: "POST",
    body: publishParams,
  });

  const publishJson = await safeJson(publishResponse);
  if (!publishResponse.ok) {
    throw new Error(formatGraphError(publishJson));
  }

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

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatGraphError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in (payload as Record<string, unknown>)) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } }).error;
    const message = err?.message ?? "Unknown error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Instagram publishing failed";
}
