import type { ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MEDIA_STATUS_FIELDS = "status_code,status";
const MEDIA_STATUS_POLL_DELAY_MS = Number(Deno.env.get("INSTAGRAM_STATUS_DELAY_MS") ?? 2000);
const MEDIA_STATUS_MAX_ATTEMPTS = Number(Deno.env.get("INSTAGRAM_STATUS_MAX_ATTEMPTS") ?? 10);

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

  await waitForMediaReady(creationId, auth.accessToken);

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

async function waitForMediaReady(creationId: string, accessToken: string) {
  const statusUrl = `${GRAPH_BASE}/${creationId}?fields=${MEDIA_STATUS_FIELDS}&access_token=${accessToken}`;

  for (let attempt = 0; attempt < MEDIA_STATUS_MAX_ATTEMPTS; attempt += 1) {
    const statusResponse = await fetch(statusUrl);
    const statusJson = await safeJson(statusResponse);

    if (!statusResponse.ok) {
      throw new Error(formatGraphError(statusJson));
    }

    const statusCode = typeof statusJson?.status_code === "string" ? statusJson.status_code : null;
    const status = typeof statusJson?.status === "string" ? statusJson.status : null;

    if (statusCode === "ERROR" || status === "ERROR") {
      const detail = typeof statusJson?.status === "string" ? statusJson.status : "Instagram media failed to process";
      throw new Error(detail);
    }

    if (statusCode === "FINISHED" || statusCode === "READY" || status === "FINISHED" || status === "READY") {
      return;
    }

    await delay(MEDIA_STATUS_POLL_DELAY_MS);
  }

  throw new Error("Instagram media container did not become ready in time");
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
