import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateConnectionMetadata } from "@/lib/connections/metadata";

type Provider = "facebook" | "instagram" | "gbp";
type Placement = "feed" | "story";

interface PublishReadinessIssue {
  code: string;
  message: string;
}

interface PublishReadinessParams {
  supabase: SupabaseClient;
  accountId: string;
  contentId: string;
  platform: Provider;
  placement: Placement;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

const METADATA_LABELS: Record<Provider, string> = {
  facebook: "Facebook Page ID",
  instagram: "Instagram Business Account ID",
  gbp: "Google Business Location ID",
};

export async function getPublishReadinessIssues({
  supabase,
  accountId,
  contentId,
  platform,
  placement,
}: PublishReadinessParams): Promise<PublishReadinessIssue[]> {
  const issues: PublishReadinessIssue[] = [];

  const connection = await loadConnection({ supabase, accountId, platform });
  if (!connection) {
    issues.push({
      code: "connection_missing",
      message: `Connect ${PROVIDER_LABELS[platform]} before scheduling this post.`,
    });
  } else {
    if (connection.status === "needs_action") {
      issues.push({
        code: "connection_needs_action",
        message: `${PROVIDER_LABELS[platform]} needs attention before scheduling.`,
      });
    }

    if (!connection.access_token) {
      issues.push({
        code: "connection_token_missing",
        message: `${PROVIDER_LABELS[platform]} access token is missing. Reconnect to continue.`,
      });
    } else if (connection.expires_at) {
      const expiry = new Date(connection.expires_at);
      if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
        issues.push({
          code: "connection_token_expired",
          message: `${PROVIDER_LABELS[platform]} access token has expired. Reconnect to continue.`,
        });
      }
    }

    const metadata = evaluateConnectionMetadata(platform, connection.metadata);
    if (!metadata.complete) {
      issues.push({
        code: "connection_metadata_missing",
        message: `Missing ${METADATA_LABELS[platform]}. Update it in Connections.`,
      });
    }
  }

  if (placement === "story" && platform === "gbp") {
    issues.push({
      code: "placement_invalid",
      message: "Stories are only supported on Facebook and Instagram.",
    });
  }

  const variantData = await loadVariantData({ supabase, contentId });
  const mediaIds = variantData.mediaIds;
  const body = variantData.body;

  if (placement === "feed" && !body.trim().length) {
    issues.push({
      code: "body_missing",
      message: "Add post copy before scheduling.",
    });
  }

  if (!mediaIds.length) {
    issues.push({
      code: "media_missing",
      message:
        placement === "story"
          ? "Stories require one processed image. Add a story image before scheduling."
          : "Attach at least one media asset before scheduling.",
    });
    return issues;
  }

  if (placement === "story" && mediaIds.length !== 1) {
    issues.push({
      code: "media_story_count",
      message: "Stories can only include one image.",
    });
  }

  const mediaAssets = await loadMediaAssets({ supabase, mediaIds });
  if (mediaAssets.length !== mediaIds.length) {
    issues.push({
      code: "media_missing_assets",
      message: "One or more media assets are missing. Reattach media before scheduling.",
    });
    return issues;
  }

  if (placement === "story") {
    const asset = mediaAssets[0];
    if (asset?.media_type !== "image") {
      issues.push({
        code: "media_story_type",
        message: "Stories only support images.",
      });
    }

    const storyVariant = resolveDerivedVariant(asset?.derived_variants, "story");
    if (!storyVariant) {
      issues.push({
        code: "media_story_derivative_missing",
        message: "Story image is still processing. Wait for derivatives or choose another image.",
      });
    }
  }

  return issues;
}

export async function assertPublishReadiness(params: PublishReadinessParams) {
  const issues = await getPublishReadinessIssues(params);
  if (!issues.length) return;
  const message = issues.map((issue) => issue.message).join(" ");
  throw new Error(message);
}

interface ConnectionRow {
  status: "active" | "expiring" | "needs_action" | null;
  access_token: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
}

async function loadConnection({
  supabase,
  accountId,
  platform,
}: {
  supabase: SupabaseClient;
  accountId: string;
  platform: Provider;
}): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .from("social_connections")
    .select("status, access_token, expires_at, metadata")
    .eq("account_id", accountId)
    .eq("provider", platform)
    .maybeSingle<ConnectionRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function loadVariantData({
  supabase,
  contentId,
}: {
  supabase: SupabaseClient;
  contentId: string;
}): Promise<{ mediaIds: string[]; body: string }> {
  const { data, error } = await supabase
    .from("content_variants")
    .select("media_ids, body")
    .eq("content_item_id", contentId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ media_ids: string[] | null; body: string | null }>();

  if (error) {
    throw error;
  }

  return {
    mediaIds: data?.media_ids ?? [],
    body: data?.body ?? "",
  };
}

interface MediaAssetRow {
  id: string;
  media_type: "image" | "video";
  processed_status: string | null;
  derived_variants: Record<string, unknown> | null;
}

async function loadMediaAssets({
  supabase,
  mediaIds,
}: {
  supabase: SupabaseClient;
  mediaIds: string[];
}): Promise<MediaAssetRow[]> {
  const { data, error } = await supabase
    .from("media_assets")
    .select("id, media_type, processed_status, derived_variants")
    .in("id", mediaIds)
    .returns<MediaAssetRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

function resolveDerivedVariant(variants: Record<string, unknown> | null | undefined, key: string) {
  if (!variants || typeof variants !== "object") {
    return null;
  }
  const value = variants[key];
  return typeof value === "string" && value.length ? value : null;
}
