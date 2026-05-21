// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { ProviderMedia, ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GBP_BASE = "https://mybusiness.googleapis.com/v4";

export async function publishToGBP({
  payload,
  auth,
  connectionMetadata,
  placement,
}: ProviderPublishRequest): Promise<ProviderPublishResult> {
  if (placement !== "feed") {
    throw new Error("Google Business Profile does not support stories");
  }

  if (!auth.accessToken) {
    throw new Error("Missing GBP access token");
  }

  const localPostParent = resolveLocalPostParent(connectionMetadata);
  if (!localPostParent) {
    throw new Error("Google Business account-qualified localPostParent metadata missing");
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

  const callToAction = resolveCallToAction(payload.previewData);
  if (callToAction) {
    requestBody.callToAction = callToAction;
  }

  const postUrl = `${GBP_BASE}/${localPostParent}/localPosts`;
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

function resolveCallToAction(previewData?: Record<string, unknown> | null) {
  const cta = previewData?.cta;
  const ctaRecord = cta && typeof cta === "object" ? cta as Record<string, unknown> : null;
  const url = getString(ctaRecord?.url) ?? getString(previewData?.ctaUrl);
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }

  const actionType = normaliseActionType(getString(ctaRecord?.action));
  return {
    actionType,
    url,
  };
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function normaliseActionType(value: string | null) {
  const candidate = value?.toUpperCase();
  const allowed = new Set(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP"]);
  return candidate && allowed.has(candidate) ? candidate : "LEARN_MORE";
}

function resolveLocalPostParent(metadata?: Record<string, unknown> | null) {
  const localPostParent = getString(metadata?.localPostParent);
  if (localPostParent && /^accounts\/[^/]+\/locations\/\d+$/.test(localPostParent)) {
    return localPostParent;
  }

  const legacyLocationId = getString(metadata?.locationId);
  if (legacyLocationId && /^accounts\/[^/]+\/locations\/\d+$/.test(legacyLocationId)) {
    return legacyLocationId;
  }

  return null;
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
