import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import { BANNER_COLOUR_HEX, parseBannerConfig, type BannerConfig } from "@/lib/scheduling/banner-config";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { MEDIA_BUCKET } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const STRIP_PX = 80;
const FONT_SIZE_MAX = 40;
const FONT_SIZE_MIN = 20;
const MAX_SHORT_SIDE_PX = 1080;
const JPEG_QUALITY = 92;
const SEPARATOR = "  ·  ";

type Placement = "feed" | "story";

type CampaignRow = {
  campaign_type: string | null;
  metadata: Record<string, unknown> | null;
} | null;

type ContentRow = {
  id: string;
  account_id: string;
  placement: Placement;
  scheduled_for: string | null;
  prompt_context: Record<string, unknown> | null;
  campaign_id: string | null;
  campaigns: CampaignRow;
};

type VariantRow = {
  id: string;
  content_item_id: string;
  media_ids: string[] | null;
  banner_state: string | null;
  bannered_media_path: string | null;
};

type MediaRow = {
  id: string;
  storage_path: string;
  media_type: "image" | "video";
  derived_variants: Record<string, unknown> | null;
};

export type BannerRenderResult =
  | {
      status: "rendered";
      contentId: string;
      variantId: string;
      storagePath: string;
      label: string;
      sourceMediaPath: string;
      scheduledAt: string | null;
      renderMetadata: Record<string, unknown>;
    }
  | {
      status: "not_applicable";
      contentId: string;
      variantId: string;
      reason: string;
    }
  | {
      status: "skipped";
      contentId: string;
      reason: string;
    };

export interface RenderBannerForContentOptions {
  contentId: string;
  variantId?: string | null;
  accountId?: string | null;
  supabase?: SupabaseClient;
}

function normaliseStoragePath(path: string) {
  if (path.startsWith(`${MEDIA_BUCKET}/`)) {
    return path.slice(MEDIA_BUCKET.length + 1);
  }
  return path;
}

function computeOutputDimensions(width: number, height: number) {
  const shortSide = Math.min(width, height);
  if (shortSide <= MAX_SHORT_SIDE_PX) {
    return { width, height };
  }

  const scale = MAX_SHORT_SIDE_PX / shortSide;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildRepeatingLabel(label: string, targetLength: number) {
  const segment = `${label}${SEPARATOR}`;
  const count = Math.max(4, Math.ceil(targetLength / Math.max(label.length * 22, 1)) + 4);
  return Array(count).fill(label).join(SEPARATOR).startsWith(segment)
    ? Array(count).fill(label).join(SEPARATOR)
    : `${label}${SEPARATOR}${Array(count).fill(label).join(SEPARATOR)}`;
}

function fitFontSize(stripThickness: number) {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.floor(stripThickness * 0.6)));
}

function buildBannerSvg({
  width,
  height,
  config,
  label,
}: {
  width: number;
  height: number;
  config: BannerConfig;
  label: string;
}) {
  const bg = BANNER_COLOUR_HEX[config.bgColour] ?? BANNER_COLOUR_HEX.gold;
  const text = BANNER_COLOUR_HEX[config.textColour] ?? BANNER_COLOUR_HEX.white;
  const fontSize = fitFontSize(STRIP_PX);
  const escapedLabel = xmlEscape(buildRepeatingLabel(label, Math.max(width, height)));
  const commonTextAttrs = [
    `fill="${text}"`,
    `font-family="Arial, Helvetica, sans-serif"`,
    `font-size="${fontSize}"`,
    `font-weight="800"`,
    `letter-spacing="3"`,
    `dominant-baseline="middle"`,
  ].join(" ");

  let rect = "";
  let textNode = "";

  if (config.position === "top" || config.position === "bottom") {
    const y = config.position === "top" ? 0 : height - STRIP_PX;
    rect = `<rect x="0" y="${y}" width="${width}" height="${STRIP_PX}" fill="${bg}" />`;
    textNode = `<text x="-40" y="${y + STRIP_PX / 2}" ${commonTextAttrs}>${escapedLabel}</text>`;
  } else {
    const x = config.position === "left" ? 0 : width - STRIP_PX;
    const rotation = config.position === "right" ? 90 : -90;
    rect = `<rect x="${x}" y="0" width="${STRIP_PX}" height="${height}" fill="${bg}" />`;
    textNode = [
      `<g transform="translate(${x + STRIP_PX / 2} ${height / 2}) rotate(${rotation})">`,
      `<text x="${-(height / 2) - 80}" y="0" ${commonTextAttrs}>${escapedLabel}</text>`,
      `</g>`,
    ].join("");
  }

  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${rect}${textNode}</svg>`,
  );
}

export function resolveBannerLabel({
  bannerConfig,
  scheduledFor,
  campaign,
}: {
  bannerConfig: BannerConfig | null;
  scheduledFor: string | null;
  campaign: CampaignRow;
}) {
  if (!bannerConfig?.enabled) return null;

  const customMessage = bannerConfig.customMessage?.trim();
  if (customMessage) {
    return customMessage.toUpperCase();
  }

  if (!campaign?.campaign_type || !campaign.metadata) {
    return null;
  }

  const timing = extractCampaignTiming({
    campaign_type: campaign.campaign_type,
    metadata: campaign.metadata,
  });
  const referenceAt = scheduledFor
    ? DateTime.fromISO(scheduledFor, { zone: "utc" })
    : DateTime.now().setZone(timing.timezone);

  return getProximityLabel({ referenceAt, campaignTiming: timing });
}

async function loadContent({
  supabase,
  contentId,
  accountId,
}: {
  supabase: SupabaseClient;
  contentId: string;
  accountId?: string | null;
}) {
  let query = supabase
    .from("content_items")
    .select("id, account_id, placement, scheduled_for, prompt_context, campaign_id, campaigns(campaign_type, metadata)")
    .eq("id", contentId);

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { data, error } = await query.maybeSingle<ContentRow>();
  if (error) throw error;
  return data ?? null;
}

async function loadVariant({
  supabase,
  contentId,
  variantId,
}: {
  supabase: SupabaseClient;
  contentId: string;
  variantId?: string | null;
}) {
  let query = supabase
    .from("content_variants")
    .select("id, content_item_id, media_ids, banner_state, bannered_media_path")
    .eq("content_item_id", contentId);

  if (variantId) {
    query = query.eq("id", variantId);
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<VariantRow>();

  if (error) throw error;
  return data ?? null;
}

async function updateVariantBannerState({
  supabase,
  variantId,
  state,
}: {
  supabase: SupabaseClient;
  variantId: string;
  state: "none" | "not_applicable" | "expected" | "rendered" | "stale";
}) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("content_variants")
    .update({
      banner_state: state,
      bannered_media_path: null,
      banner_label: null,
      banner_rendered_for_scheduled_at: null,
      banner_source_media_path: null,
      banner_render_metadata: null,
      updated_at: nowIso,
    })
    .eq("id", variantId);

  if (error) throw error;
}

export async function resetBannerStateForContent(options: RenderBannerForContentOptions) {
  const supabase = options.supabase ?? createServiceSupabaseClient();
  const content = await loadContent({
    supabase,
    contentId: options.contentId,
    accountId: options.accountId,
  });

  if (!content) {
    throw new Error("Content item not found");
  }

  const variant = await loadVariant({
    supabase,
    contentId: options.contentId,
    variantId: options.variantId,
  });

  if (!variant) {
    return { status: "skipped" as const, reason: "variant_missing" };
  }

  const bannerConfig = parseBannerConfig(content.prompt_context);
  if (!bannerConfig?.enabled) {
    await updateVariantBannerState({
      supabase,
      variantId: variant.id,
      state: "none",
    });
    return { status: "skipped" as const, reason: "banner_disabled" };
  }

  const label = resolveBannerLabel({
    bannerConfig,
    scheduledFor: content.scheduled_for,
    campaign: content.campaigns,
  });

  await updateVariantBannerState({
    supabase,
    variantId: variant.id,
    state: label ? "expected" : "not_applicable",
  });

  return {
    status: label ? "expected" as const : "not_applicable" as const,
    label,
    variantId: variant.id,
  };
}

export async function renderBannerForContent(options: RenderBannerForContentOptions): Promise<BannerRenderResult> {
  const supabase = options.supabase ?? createServiceSupabaseClient();
  const content = await loadContent({
    supabase,
    contentId: options.contentId,
    accountId: options.accountId,
  });

  if (!content) {
    throw new Error("Content item not found");
  }

  const bannerConfig = parseBannerConfig(content.prompt_context);
  if (!bannerConfig?.enabled) {
    return { status: "skipped", contentId: content.id, reason: "banner_disabled" };
  }

  const variant = await loadVariant({
    supabase,
    contentId: content.id,
    variantId: options.variantId,
  });

  if (!variant) {
    throw new Error("Variant missing for content item");
  }

  const label = resolveBannerLabel({
    bannerConfig,
    scheduledFor: content.scheduled_for,
    campaign: content.campaigns,
  });

  if (!label) {
    await updateVariantBannerState({
      supabase,
      variantId: variant.id,
      state: "not_applicable",
    });
    return {
      status: "not_applicable",
      contentId: content.id,
      variantId: variant.id,
      reason: "no_label_due",
    };
  }

  const mediaId = variant.media_ids?.[0];
  if (!mediaId) {
    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
    throw new Error("No source image available for banner rendering");
  }

  const { data: media, error: mediaError } = await supabase
    .from("media_assets")
    .select("id, storage_path, media_type, derived_variants")
    .eq("id", mediaId)
    .maybeSingle<MediaRow>();

  if (mediaError) throw mediaError;
  if (!media) {
    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
    throw new Error("Media asset not found");
  }
  if (media.media_type !== "image") {
    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
    throw new Error("Banner rendering requires an image asset");
  }

  let sourcePath = normaliseStoragePath(media.storage_path);
  if (content.placement === "story") {
    const storyPath = media.derived_variants?.story;
    if (typeof storyPath !== "string" || !storyPath.length) {
      await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
      throw new Error("Story derivative not available for banner rendering");
    }
    sourcePath = normaliseStoragePath(storyPath);
  }

  const { data: sourceBlob, error: downloadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(sourcePath);

  if (downloadError || !sourceBlob) {
    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
    throw new Error(downloadError?.message ?? "Unable to download source image");
  }

  const sourceBuffer = Buffer.from(await sourceBlob.arrayBuffer());
  const sourceImage = sharp(sourceBuffer).rotate();
  const metadata = await sourceImage.metadata();
  const naturalWidth = metadata.width;
  const naturalHeight = metadata.height;

  if (!naturalWidth || !naturalHeight) {
    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
    throw new Error("Unable to read source image dimensions");
  }

  const { width, height } = computeOutputDimensions(naturalWidth, naturalHeight);
  const overlay = buildBannerSvg({ width, height, config: bannerConfig, label });
  const rendered = await sourceImage
    .resize(width, height, { fit: "fill" })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const storagePath = `banners/${content.id}/${variant.id}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, rendered, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
    throw uploadError;
  }

  const renderMetadata = {
    position: bannerConfig.position,
    bgColour: bannerConfig.bgColour,
    textColour: bannerConfig.textColour,
    placement: content.placement,
    width,
    height,
    sourceMediaId: media.id,
  };
  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("content_variants")
    .update({
      banner_state: "rendered",
      bannered_media_path: storagePath,
      banner_label: label,
      banner_rendered_for_scheduled_at: content.scheduled_for,
      banner_source_media_path: sourcePath,
      banner_render_metadata: renderMetadata,
      updated_at: nowIso,
    })
    .eq("id", variant.id);

  if (updateError) throw updateError;

  return {
    status: "rendered",
    contentId: content.id,
    variantId: variant.id,
    storagePath,
    label,
    sourceMediaPath: sourcePath,
    scheduledAt: content.scheduled_for,
    renderMetadata,
  };
}
