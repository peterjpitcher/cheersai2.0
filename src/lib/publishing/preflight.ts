import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { hasTokenValue } from "@/lib/connections/readiness";
import { lintContent } from "@/lib/ai/content-rules";
import type { InstantPostAdvancedOptions } from "@/lib/create/schema";

type Provider = "facebook" | "instagram";
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
};

const METADATA_LABELS: Record<Provider, string> = {
  facebook: "Facebook Page ID",
  instagram: "Instagram Business Account ID",
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

    const hasAccessToken = hasTokenValue(connection.access_token) || await hasVaultAccessToken(supabase, connection.id);

    if (!hasAccessToken) {
      issues.push({
        code: "connection_token_missing",
        message: `${PROVIDER_LABELS[platform]} access token is missing. Reconnect to continue.`,
      });
    } else {
      // Prefer token_expires_at (v2); fall back to legacy expires_at
      const effectiveExpiry = connection.token_expires_at ?? connection.expires_at;
      if (effectiveExpiry) {
        const expiry = new Date(effectiveExpiry);
        if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
          issues.push({
            code: "connection_token_expired",
            message: `${PROVIDER_LABELS[platform]} access token has expired. Reconnect to continue.`,
          });
        }
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

  const variantData = await loadVariantData({ supabase, contentId });
  const mediaIds = variantData.mediaIds;
  const body = variantData.body;
  const { promptContext, scheduledFor } = await loadContentContext({ supabase, contentId });
  const lint = lintContent({
    body,
    platform,
    placement,
    context: promptContext,
    advanced: (promptContext?.advanced as Partial<InstantPostAdvancedOptions>) ?? undefined,
    scheduledFor,
  });
  if (!lint.pass) {
    issues.push({
      code: "lint_failed",
      message: "Post copy failed quality checks. Regenerate the content before scheduling.",
    });
  }

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
  id: string;
  status: "active" | "expiring" | "needs_action" | null;
  access_token?: string | null;
  token_expires_at: string | null;
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
    .select("id, status, access_token, token_expires_at, expires_at, metadata")
    .eq("account_id", accountId)
    .eq("provider", platform)
    .maybeSingle<ConnectionRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function hasVaultAccessToken(supabase: SupabaseClient, connectionId: string) {
  const { data, error } = await supabase
    .from("token_vault")
    .select("id")
    .eq("social_connection_id", connectionId)
    .eq("token_type", "access")
    .maybeSingle<{ id: string }>();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "PGRST205" || code === "42703" || code === "42P01") {
      return false;
    }
    throw error;
  }

  return Boolean(data?.id);
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

async function loadContentContext({
  supabase,
  contentId,
}: {
  supabase: SupabaseClient;
  contentId: string;
}): Promise<{ promptContext: Record<string, unknown> | null; scheduledFor: Date | null }> {
  const { data, error } = await supabase
    .from("content_items")
    .select("prompt_context, scheduled_for")
    .eq("id", contentId)
    .maybeSingle<{ prompt_context: Record<string, unknown> | null; scheduled_for: string | null }>();

  if (error) {
    throw error;
  }

  const scheduledFor = data?.scheduled_for ? new Date(data.scheduled_for) : null;

  return { promptContext: data?.prompt_context ?? null, scheduledFor };
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
