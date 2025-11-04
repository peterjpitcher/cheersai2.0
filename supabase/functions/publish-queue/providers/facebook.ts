import type { ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function parseFacebookResponse(response: Response) {
  const clone = response.clone();
  try {
    return await response.json();
  } catch {
    try {
      const text = await clone.text();
      return text.length ? text : null;
    } catch {
      return null;
    }
  }
}

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

    // Fetch the story image bytes so we can upload via multipart/form-data
    const mediaResponse = await fetch(media.url, { method: "GET" });
    if (!mediaResponse.ok) {
      throw new Error(
        `[facebook_story_fetch] status=${mediaResponse.status} message=Unable to fetch media from storage`,
      );
    }

    const contentType = mediaResponse.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const fileName = extractFileName(media.url);
    const file = new File([new Uint8Array(arrayBuffer)], fileName, { type: contentType });

    // Step 1: upload the photo as unpublished content
    const uploadUrl = `${GRAPH_BASE}/${pageId}/photos?access_token=${auth.accessToken}`;
    const uploadForm = new FormData();
    uploadForm.set("published", "false");
    uploadForm.set("source", file);

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      body: uploadForm,
    });
    const uploadTraceId = uploadResponse.headers.get("x-fb-trace-id") ?? null;
    const uploadText = await uploadResponse.text();
    console.info("[facebook] story upload payload", {
      uploadUrl,
      status: uploadResponse.status,
      traceId: uploadTraceId,
      body: uploadText.slice(0, 500),
    });
    const uploadJson = await safeJsonResponse(uploadText);
    if (!uploadResponse.ok) {
      const formatted = formatGraphError(uploadJson ?? uploadText);
      throw new Error(
        `[facebook_story_upload] status=${uploadResponse.status} message=${formatted} trace=${uploadTraceId ?? "n/a"}`,
      );
    }

    const photoId =
      uploadJson && typeof uploadJson === "object"
        ? (uploadJson as Record<string, unknown>).id
        : undefined;
    if (typeof photoId !== "string" || !photoId.length) {
      throw new Error("Facebook story upload response missing photo id");
    }

    // Step 2: publish the story referencing the uploaded photo
    const publishUrl = `${GRAPH_BASE}/${pageId}/photo_stories?access_token=${auth.accessToken}`;
    const publishForm = new FormData();
    publishForm.set("photo_id", photoId);

    const response = await fetch(publishUrl, {
      method: "POST",
      body: publishForm,
    });
    const traceId = response.headers.get("x-fb-trace-id") ?? null;
    const responseText = await response.text();
    console.info("[facebook] story publish payload", {
      publishUrl,
      status: response.status,
      traceId,
      body: responseText.slice(0, 500),
    });
    const rawResponse = await safeJsonResponse(responseText);
    if (!response.ok) {
      const formatted = formatGraphError(rawResponse ?? responseText);
      throw new Error(
        `[facebook_story] status=${response.status} message=${formatted} trace=${traceId ?? "n/a"}`,
      );
    }

    const storyId = resolveStoryExternalId(rawResponse, photoId);
    if (!storyId) {
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

    rawResponse = await parseFacebookResponse(response);
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

    rawResponse = await parseFacebookResponse(response);
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

function extractFileName(url: string) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "story.jpg";
    if (last.includes(".")) {
      return last;
    }
    return `${last}.jpg`;
  } catch {
    return "story.jpg";
  }
}

function resolveStoryExternalId(payload: unknown, fallbackPhotoId: string) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const candidates = [record.id, record.post_id, record.story_id];
    for (const value of candidates) {
      if (typeof value === "string" && value.length) {
        return value;
      }
    }

    if (record.success === true && fallbackPhotoId) {
      return fallbackPhotoId;
    }

    return null;
}
