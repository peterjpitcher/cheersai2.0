import type { ProviderMedia, ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GBP_BASE = "https://mybusiness.googleapis.com/v4";

export async function publishToGBP({
  payload,
  auth,
  connectionMetadata,
}: ProviderPublishRequest): Promise<ProviderPublishResult> {
  if (!auth.accessToken) {
    throw new Error("Missing GBP access token");
  }

  const locationId = typeof connectionMetadata?.locationId === "string" ? connectionMetadata.locationId : "";
  if (!locationId) {
    throw new Error("Google Business locationId metadata missing");
  }

  const summary = truncateSummary(payload.body);
  const requestBody: Record<string, unknown> = {
    languageCode: "en-GB",
    summary,
    topicType: "STANDARD",
  };

  const mediaAttachments = buildMediaAttachments(payload.media);
  if (mediaAttachments.length) {
    requestBody.media = mediaAttachments;
  }

  const postUrl = `${GBP_BASE}/${locationId}/localPosts`;
  const response = await fetch(postUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  const rawResponse = await safeJson(response);
  if (!response.ok) {
    throw new Error(formatGbpError(rawResponse));
  }

  const name = rawResponse?.name;
  if (typeof name !== "string" || !name.length) {
    throw new Error("GBP response missing post name");
  }

  return {
    platform: "gbp",
    externalId: name,
    payloadPreview: summary.slice(0, 140),
    publishedAt: new Date().toISOString(),
    rawResponse,
  };
}

function truncateSummary(body: string) {
  const trimmed = body.trim();
  return trimmed.length > 1500 ? `${trimmed.slice(0, 1497)}...` : trimmed;
}

function buildMediaAttachments(media: ProviderMedia[]) {
  return media
    .filter((item) => item.mediaType === "image")
    .map((item) => ({
      mediaFormat: "PHOTO",
      sourceUrl: item.url,
    }));
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatGbpError(payload: unknown) {
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: { status?: string; message?: string } }).error;
    if (err) {
      const status = err.status ? `${err.status}: ` : "";
      return `${status}${err.message ?? "Unknown error"}`;
    }
  }
  return "Google Business publishing failed";
}
