import type { ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export async function publishToFacebook({
  payload,
  auth,
  connectionMetadata,
  placement,
}: ProviderPublishRequest): Promise<ProviderPublishResult> {
  if (!auth.accessToken) {
    throw new Error("Missing Facebook access token");
  }

  const pageId = typeof connectionMetadata?.pageId === "string" ? connectionMetadata.pageId : "";
  if (!pageId) {
    throw new Error("Facebook pageId metadata missing");
  }

  if (placement === "story") {
    if (!payload.media.length) {
      throw new Error("Facebook stories require an image attachment");
    }

    const media = payload.media[0];
    if (media.mediaType !== "image") {
      throw new Error("Facebook stories currently support images only");
    }

    const publishUrl = `${GRAPH_BASE}/${pageId}/photo_stories`;
    const params = new URLSearchParams({
      file_url: media.url,
      access_token: auth.accessToken,
    });

    const response = await fetch(publishUrl, {
      method: "POST",
      body: params,
    });
    const responseText = await response.text();
    console.info("[facebook] story publish payload", {
      publishUrl,
      params: Object.fromEntries(params.entries()),
      status: response.status,
      body: responseText,
    });
    const rawResponse = await safeJsonResponse(responseText);
    if (!response.ok) {
      const formatted = formatGraphError(rawResponse ?? responseText);
      throw new Error(
        `[facebook_story] status=${response.status} message=${formatted} body=${responseText.slice(0, 500)}`,
      );
    }

    const storyId =
      rawResponse && typeof rawResponse === "object"
        ? (rawResponse as Record<string, unknown>).id
        : undefined;
    if (typeof storyId !== "string" || !storyId.length) {
      throw new Error("Facebook story response missing id");
    }

    return {
      platform: "facebook",
      externalId: storyId,
      payloadPreview: "Facebook story image",
      publishedAt: new Date().toISOString(),
      rawResponse,
    };
  }

  const message = payload.body.trim();
  const hasMedia = payload.media.length > 0;
  let rawResponse: unknown;
  let externalId = "";

  if (hasMedia && payload.media[0]?.mediaType === "image") {
    const media = payload.media[0];
    const publishUrl = `${GRAPH_BASE}/${pageId}/photos`;
    const params = new URLSearchParams({
      url: media.url,
      caption: message,
      published: "true",
      access_token: auth.accessToken,
    });

    const response = await fetch(publishUrl, {
      method: "POST",
      body: params,
    });

    rawResponse = await safeJson(response);
    if (!response.ok) {
      throw new Error(formatGraphError(rawResponse));
    }

    const postId = (rawResponse as Record<string, unknown>).post_id ?? (rawResponse as Record<string, unknown>).id;
    if (typeof postId !== "string" || !postId.length) {
      throw new Error("Facebook response missing post identifier");
    }
    externalId = postId;
  } else {
    const feedUrl = `${GRAPH_BASE}/${pageId}/feed`;
    const params = new URLSearchParams({
      message,
      access_token: auth.accessToken,
    });

    const response = await fetch(feedUrl, {
      method: "POST",
      body: params,
    });

    rawResponse = await safeJson(response);
    if (!response.ok) {
      throw new Error(formatGraphError(rawResponse));
    }

    const postId = (rawResponse as Record<string, unknown>).id;
    if (typeof postId !== "string" || !postId.length) {
      throw new Error("Facebook response missing post identifier");
    }
    externalId = postId;
  }

  return {
    platform: "facebook",
    externalId,
    payloadPreview: message.slice(0, 140),
    publishedAt: new Date().toISOString(),
    rawResponse,
  };
}

async function safeJsonResponse(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function formatGraphError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } }).error;
    const message = err?.message ?? "Unknown error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Facebook publishing failed";
}
