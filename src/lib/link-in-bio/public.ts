import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE, MEDIA_BUCKET } from "@/lib/constants";
import { normaliseStoragePath, resolvePreviewCandidates, type PreviewCandidate } from "@/lib/library/data";
import {
  bannerConfigResolver,
  type AccountBannerDefaults,
  type BannerPosition,
  type PostBannerOverrides,
} from "@/lib/banner/config";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

import type {
  LinkInBioFont,
  LinkInBioProfile,
  LinkInBioTemplate,
  PublicCampaignCard,
  PublicLinkInBioPageData,
  PublicLinkInBioTile,
} from "./types";

interface LinkInBioProfileRow {
  account_id: string;
  slug: string;
  display_name: string | null;
  bio: string | null;
  logo_url: string | null;
  hero_media_id: string | null;
  theme: Record<string, unknown> | null;
  phone_number: string | null;
  whatsapp_number: string | null;
  booking_url: string | null;
  menu_url: string | null;
  parking_url: string | null;
  directions_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  template: string;
  font_family: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

interface LinkInBioTileRow {
  id: string;
  account_id: string;
  title: string;
  subtitle: string | null;
  cta_label: string;
  cta_url: string;
  media_asset_id: string | null;
  position: number | null;
  enabled: boolean | null;
  created_at: string;
  updated_at: string;
}

interface CampaignVariantRow {
  media_ids: string[] | null;
  banner_enabled: boolean | null;
  banner_text_override: string | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
}

interface CampaignContentRow {
  id: string;
  campaign_id: string | null;
  scheduled_for: string | null;
  status: string;
  placement: "feed" | "story";
  prompt_context: Record<string, unknown> | null;
  content_variants: CampaignVariantRow[] | CampaignVariantRow | null;
  platform: "facebook" | "instagram" | "gbp";
  campaigns: {
    id: string;
    name: string | null;
    campaign_type: string;
    link_in_bio_url: string | null;
    account_id: string;
    metadata: Record<string, unknown> | null;
  } | null;
}

interface PostingDefaultsRow {
  banners_enabled: boolean;
  banner_position: BannerPosition;
  banner_bg: string;
  banner_text_colour: string;
}

interface MediaAssetRow {
  id: string;
  media_type: "image" | "video";
  storage_path: string;
  derived_variants: Record<string, string> | null;
}

type PublicPreviewShape = "square" | "story";
type PublicMediaPreview = { url: string; shape: PublicPreviewShape };
type PublicMediaPreviewByShape = Partial<Record<PublicPreviewShape, PublicMediaPreview>>;

interface AccountRow {
  timezone: string | null;
}

interface CampaignEntry {
  scheduled: DateTime;
  slotLabel: string | null;
  mediaId: string | null;
  platform: CampaignContentRow["platform"];
  promptContext: Record<string, unknown> | null;
  bannerOverrides: PostBannerOverrides;
}

interface CampaignAggregate {
  id: string;
  name: string;
  linkUrl: string;
  campaignType: string;
  campaignMetadata: Record<string, unknown>;
  earliest: DateTime | null;
  latest: DateTime | null;
  entries: CampaignEntry[];
}

function shapeProfile(row: LinkInBioProfileRow): LinkInBioProfile {
  return {
    accountId: row.account_id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    logoUrl: row.logo_url ?? null,
    heroMediaId: row.hero_media_id,
    theme: row.theme ?? {},
    phoneNumber: row.phone_number,
    whatsappNumber: row.whatsapp_number,
    bookingUrl: row.booking_url,
    menuUrl: row.menu_url,
    parkingUrl: row.parking_url,
    directionsUrl: row.directions_url,
    facebookUrl: row.facebook_url,
    instagramUrl: row.instagram_url,
    websiteUrl: row.website_url,
    template: (row.template ?? 'classic') as LinkInBioTemplate,
    fontFamily: (row.font_family ?? 'inter') as LinkInBioFont,
    isPublished: row.is_published ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies LinkInBioProfile;
}

function resolveCampaignLinkUrl(campaign: NonNullable<CampaignContentRow["campaigns"]>): string {
  const direct = campaign.link_in_bio_url?.trim();
  if (direct) return direct;

  const metadata = campaign.metadata ?? {};
  const fallback = typeof metadata.linkInBioUrl === "string" ? metadata.linkInBioUrl.trim() : "";
  if (fallback) return fallback;

  const ctaUrl = typeof metadata.ctaUrl === "string" ? metadata.ctaUrl.trim() : "";
  return ctaUrl;
}

export async function getPublicLinkInBioPageData(slug: string): Promise<PublicLinkInBioPageData | null> {
  const supabase = tryCreateServiceSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase service credentials are not configured");
  }

  try {
    const { data: profileRow, error: profileError } = await supabase
      .from("link_in_bio_profiles")
      .select(
        "account_id, slug, display_name, bio, logo_url, hero_media_id, theme, phone_number, whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url, instagram_url, website_url, template, font_family, is_published, created_at, updated_at",
      )
      .eq("slug", slug)
      .maybeSingle<LinkInBioProfileRow>();

    if (profileError) {
      if (isSchemaMissingError(profileError)) {
        return null;
      }
      throw profileError;
    }

    if (!profileRow) {
      return null;
    }

    const profile = shapeProfile(profileRow);
    const accountId = profile.accountId;

    const [
      { data: accountRow, error: accountError },
      { data: tileRows, error: tileError },
      { data: postingDefaultsRow, error: postingDefaultsError },
    ] = await Promise.all([
      supabase
        .from("accounts")
        .select("timezone")
        .eq("id", accountId)
        .maybeSingle<AccountRow>(),
      supabase
        .from("link_in_bio_tiles")
        .select("id, account_id, title, subtitle, cta_label, cta_url, media_asset_id, position, enabled, created_at, updated_at")
        .eq("account_id", accountId)
        .eq("enabled", true)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .returns<LinkInBioTileRow[]>(),
      supabase
        .from("posting_defaults")
        .select("banners_enabled, banner_position, banner_bg, banner_text_colour")
        .eq("account_id", accountId)
        .maybeSingle<PostingDefaultsRow>(),
    ]);

    if (accountError && !isSchemaMissingError(accountError)) {
      throw accountError;
    }

    if (tileError && !isSchemaMissingError(tileError)) {
      throw tileError;
    }

    if (postingDefaultsError && !isSchemaMissingError(postingDefaultsError)) {
      throw postingDefaultsError;
    }

    const accountBannerDefaults: AccountBannerDefaults | null = postingDefaultsRow
      ? {
          banners_enabled: postingDefaultsRow.banners_enabled,
          banner_position: postingDefaultsRow.banner_position,
          banner_bg: postingDefaultsRow.banner_bg,
          banner_text_colour: postingDefaultsRow.banner_text_colour,
        }
      : null;

    const timezone = accountRow?.timezone ?? DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(timezone);

    const { data: campaignRows, error: campaignError } = await supabase
      .from("content_items")
      .select(
        "id, campaign_id, scheduled_for, status, placement, prompt_context, platform, content_variants(media_ids, banner_enabled, banner_text_override, banner_position, banner_bg, banner_text_colour), campaigns!inner(id, name, campaign_type, link_in_bio_url, account_id, metadata)",
      )
      .eq("campaigns.account_id", accountId)
      .eq("placement", "feed")
      .in("platform", ["instagram", "facebook", "gbp"])
      .in("status", ["scheduled", "publishing", "posted"])
      .order("scheduled_for", { ascending: true })
      .returns<CampaignContentRow[]>();

    if (campaignError && !isSchemaMissingError(campaignError)) {
      throw campaignError;
    }

    const campaignContent = (campaignRows ?? []).filter((row) => row.campaign_id && row.scheduled_for && row.campaigns);

    const mediaAssetIds = new Set<string>();
    if (profile.heroMediaId) {
      mediaAssetIds.add(profile.heroMediaId);
    }
    for (const tile of tileRows ?? []) {
      if (tile.media_asset_id) {
        mediaAssetIds.add(tile.media_asset_id);
      }
    }

    const campaignMeta = new Map<string, CampaignAggregate>();

    const normaliseVariants = (
      variants: CampaignContentRow["content_variants"],
    ): CampaignVariantRow[] => {
      if (!variants) return [];
      return Array.isArray(variants) ? variants : [variants];
    };

    for (const row of campaignContent) {
      const scheduled = DateTime.fromISO(row.scheduled_for!).setZone(timezone);

      const aggregate = campaignMeta.get(row.campaigns!.id) ?? {
        id: row.campaigns!.id,
        name: row.campaigns!.name ?? "Untitled campaign",
        linkUrl: resolveCampaignLinkUrl(row.campaigns!),
        campaignType: row.campaigns!.campaign_type,
        campaignMetadata: row.campaigns!.metadata ?? {},
        earliest: null,
        latest: null,
        entries: [],
      } satisfies CampaignAggregate;

      if (!aggregate.earliest || scheduled < aggregate.earliest) {
        aggregate.earliest = scheduled;
      }
      if (!aggregate.latest || scheduled > aggregate.latest) {
        aggregate.latest = scheduled;
      }

      const variantRows = normaliseVariants(row.content_variants);
      const firstVariant = variantRows[0] ?? null;
      const mediaIds = variantRows
        .flatMap((variant) => variant.media_ids ?? [])
        .filter((value): value is string => Boolean(value));
      if (mediaIds.length) {
        mediaAssetIds.add(mediaIds[0]);
      }

      const promptContext = row.prompt_context ?? {};
      const slotLabel = typeof promptContext?.slot === "string" && promptContext.slot.length ? promptContext.slot : null;

      aggregate.entries.push({
        scheduled,
        slotLabel,
        mediaId: mediaIds[0] ?? null,
        platform: row.platform,
        promptContext: row.prompt_context,
        bannerOverrides: {
          banner_enabled: firstVariant?.banner_enabled ?? null,
          banner_text_override: firstVariant?.banner_text_override ?? null,
          banner_position: firstVariant?.banner_position ?? null,
          banner_bg: firstVariant?.banner_bg ?? null,
          banner_text_colour: firstVariant?.banner_text_colour ?? null,
        },
      });

      campaignMeta.set(row.campaigns!.id, aggregate);
    }

    const assetMaps = await fetchMediaAssets(Array.from(mediaAssetIds));

    const campaignCards: PublicCampaignCard[] = [];

    for (const aggregate of campaignMeta.values()) {
      if (!aggregate.entries.length) {
        continue;
      }

      if (!aggregate.linkUrl) {
        continue;
      }

      const sortedEntries = [...aggregate.entries].sort((a, b) => a.scheduled.toMillis() - b.scheduled.toMillis());
      const firstEntry = sortedEntries[0];
      const lastEntry = sortedEntries[sortedEntries.length - 1];
      if (!firstEntry || !lastEntry) {
        continue;
      }

      if (now < firstEntry.scheduled) {
        continue;
      }

      const campaignEnd = lastEntry.scheduled.endOf("day");
      if (now > campaignEnd) {
        continue;
      }

      const platformRank: Record<CampaignContentRow["platform"], number> = {
        instagram: 0,
        facebook: 1,
        gbp: 2,
      };

      const todaysEntries = sortedEntries
        .filter((entry) => entry.scheduled.hasSame(now, "day"))
        .sort((a, b) => {
          const rankDiff = (platformRank[a.platform] ?? 99) - (platformRank[b.platform] ?? 99);
          if (rankDiff !== 0) return rankDiff;
          return a.scheduled.toMillis() - b.scheduled.toMillis();
        });

      const pastEntries = sortedEntries.filter((entry) => entry.scheduled.toMillis() <= now.toMillis());

      const selected = todaysEntries[0]
        ?? pastEntries[pastEntries.length - 1]
        ?? firstEntry;

      const shapePreviews = selected.mediaId ? assetMaps.previewsByShape.get(selected.mediaId) ?? null : null;
      const preview = selected.mediaId ? shapePreviews?.square ?? assetMaps.previews.get(selected.mediaId) ?? null : null;
      const mediaType = selected.mediaId ? assetMaps.mediaTypes.get(selected.mediaId) ?? "image" : "image";

      const scheduledIso = selected.scheduled.toISO() ?? now.toISO()!;
      const endIso = campaignEnd.toISO() ?? scheduledIso;

      const card: PublicCampaignCard = {
        id: aggregate.id,
        campaignId: aggregate.id,
        name: aggregate.name,
        scheduledFor: scheduledIso,
        endAt: endIso,
        linkUrl: aggregate.linkUrl,
        slotLabel: selected.slotLabel,
        media: preview
          ? {
              url: preview.url,
              mediaType,
              shape: "square",
            }
          : null,
      };

      // Resolve the banner config from per-post overrides + account defaults,
      // then attach the proximity label if one is due. This mirrors the
      // publish-time render so the public surface stays in sync with what
      // gets posted. The override (textOverride) is independent of the
      // proximity label — when only an override is set, the banner still
      // renders (BannerOverlay falls back to textOverride when label is
      // null). So we expose bannerConfig whenever banners are enabled, and
      // expose bannerLabel only when a proximity label is due.
      if (accountBannerDefaults) {
        const resolvedConfig = bannerConfigResolver(accountBannerDefaults, selected.bannerOverrides);
        if (resolvedConfig.enabled) {
          const campaignTiming = extractCampaignTiming({
            campaign_type: aggregate.campaignType,
            metadata: aggregate.campaignMetadata,
          });
          const label = getProximityLabel({
            referenceAt: DateTime.now().setZone(timezone),
            campaignTiming,
          });
          const overrideTrim = resolvedConfig.textOverride?.trim();
          const hasOverride = Boolean(overrideTrim && overrideTrim.length > 0);
          if (hasOverride || label) {
            card.bannerConfig = resolvedConfig;
            // bannerLabel mirrors what BannerOverlay would render when no
            // override is in play; BannerOverlay itself prioritises
            // textOverride over label, so we only need to populate the
            // proximity label when there is one.
            card.bannerLabel = label;
          }
        }
      }

      campaignCards.push(card);
    }

    campaignCards.sort((a, b) => {
      const aDeadline = DateTime.fromISO(a.endAt);
      const bDeadline = DateTime.fromISO(b.endAt);
      if (aDeadline.toMillis() !== bDeadline.toMillis()) {
        return aDeadline.toMillis() - bDeadline.toMillis();
      }
      const aScheduled = DateTime.fromISO(a.scheduledFor);
      const bScheduled = DateTime.fromISO(b.scheduledFor);
      return bScheduled.toMillis() - aScheduled.toMillis();
    });

    const tiles: PublicLinkInBioTile[] = (tileRows ?? []).map((tile) => {
      const preview = tile.media_asset_id ? assetMaps.previews.get(tile.media_asset_id) ?? null : null;
      return {
        id: tile.id,
        title: tile.title,
        subtitle: tile.subtitle,
        ctaLabel: tile.cta_label,
        ctaUrl: tile.cta_url,
        media: preview,
      } satisfies PublicLinkInBioTile;
    });

    const logoMedia = await resolveLogoMedia(supabase, profile.logoUrl);
    const heroMedia = profile.heroMediaId ? assetMaps.previews.get(profile.heroMediaId) ?? null : null;

    return {
      profile,
      tiles,
      campaigns: campaignCards,
      logoMedia,
      heroMedia,
    } satisfies PublicLinkInBioPageData;
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return null;
    }
    throw error;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveLogoMedia(
  supabase: NonNullable<ReturnType<typeof tryCreateServiceSupabaseClient>>,
  logoUrl: string | null,
): Promise<{ url: string } | null> {
  const value = logoUrl?.trim();
  if (!value) return null;

  if (isHttpUrl(value)) {
    return { url: value };
  }

  const path = normaliseStoragePath(value);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, 600);

  if (error || !data?.signedUrl) {
    console.error("[link-in-bio] failed to sign logo media", error);
    return null;
  }

  return { url: data.signedUrl };
}

async function fetchMediaAssets(assetIds: string[]) {
  const supabase = tryCreateServiceSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase service credentials are not configured");
  }

  if (!assetIds.length) {
    return {
      previews: new Map<string, PublicMediaPreview>(),
      previewsByShape: new Map<string, PublicMediaPreviewByShape>(),
      mediaTypes: new Map<string, "image" | "video">(),
    };
  }

  const { data: rows, error } = await supabase
    .from("media_assets")
    .select("id, media_type, storage_path, derived_variants")
    .in("id", assetIds)
    .returns<MediaAssetRow[]>();

  if (error) {
    throw error;
  }

  const previewCandidatesByAsset = new Map<string, PreviewCandidate[]>();
  const mediaTypes = new Map<string, "image" | "video">();
  const paths = new Set<string>();

  for (const row of rows ?? []) {
    mediaTypes.set(row.id, row.media_type === "video" ? "video" : "image");
    const candidates = resolvePreviewCandidates({
      storagePath: row.storage_path,
      derivedVariants: row.derived_variants ?? {},
    });
    const originalPath = normaliseStoragePath(row.storage_path);
    const prioritised = [
      ...candidates.filter((candidate) => candidate.path === originalPath),
      ...candidates.filter((candidate) => candidate.path !== originalPath),
    ];
    previewCandidatesByAsset.set(row.id, prioritised);
    for (const candidate of candidates) {
      paths.add(candidate.path);
    }
  }

  const previews = new Map<string, PublicMediaPreview>();
  const previewsByShape = new Map<string, PublicMediaPreviewByShape>();

  if (paths.size) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(Array.from(paths), 600);

    if (signedError) {
      throw signedError;
    }

    const urlByPath = new Map<string, string>();
    for (const entry of signed ?? []) {
      if (entry?.path && !entry.error && entry.signedUrl) {
        urlByPath.set(entry.path, entry.signedUrl);
      }
    }

    for (const [assetId, candidates] of previewCandidatesByAsset.entries()) {
      const shapeMap = previewsByShape.get(assetId) ?? {};
      for (const candidate of candidates) {
        if (shapeMap[candidate.shape]) continue;
        const signedUrl = urlByPath.get(candidate.path);
        if (!signedUrl) continue;
        shapeMap[candidate.shape] = { url: signedUrl, shape: candidate.shape };
      }
      previewsByShape.set(assetId, shapeMap);

      const selected = candidates.find((candidate) => urlByPath.has(candidate.path));
      if (!selected) continue;
      const signedUrl = urlByPath.get(selected.path);
      if (!signedUrl) continue;
      previews.set(assetId, { url: signedUrl, shape: selected.shape });
    }
  }

  return { previews, previewsByShape, mediaTypes };
}
