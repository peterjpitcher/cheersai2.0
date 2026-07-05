"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAuthContext } from "@/lib/auth/server";
import { MEDIA_BUCKET } from "@/lib/constants";
import { normaliseTag, normaliseTags } from "@/lib/library/tags";
import { SYSTEM_MEDIA_TAGS } from "@/lib/library/system-tags";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { MediaAssetSummary } from "@/lib/library/data";
import { resolvePreviewCandidates, normaliseStoragePath, type PreviewCandidate } from "@/lib/library/data";

const REVALIDATE_PATHS = ["/library", "/create", "/planner", "/campaigns", "/link-in-bio", "/tournaments"] as const;

interface RequestUploadInput {
  fileName: string;
  mimeType: string;
  size: number;
}

type MediaType = "image" | "video";

type DerivativeKey = "story" | "square" | "landscape";

type ReplacementMediaAssetRow = {
  id: string;
  account_id: string;
  storage_path: string;
  file_name: string;
  media_type: MediaType;
  mime_type: string | null;
  size_bytes: number | null;
  tags: string[] | null;
  processed_status: MediaAssetSummary["processedStatus"] | null;
  processed_at: string | null;
  derived_variants: Record<string, string> | null;
  aspect_class: MediaAssetSummary["aspectClass"] | null;
};

type ContentVariantMediaRow = {
  id: string;
  media_ids: string[] | null;
};

type AttachmentRow = {
  id: string;
  content_item_id: string;
};

type IdRow = { id: string };

interface SignedUpload {
  uploadUrl: string;
  storagePath: string;
  contentType: string;
}

interface RequestUploadResult {
  assetId: string;
  uploadUrl: string;
  storagePath: string;
  derivativeUploadUrls?: Partial<Record<DerivativeKey, SignedUpload>>;
  mediaType: MediaType;
}

export async function requestMediaUpload(input: RequestUploadInput) {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  await ensureBucketExists(supabase);

  const assetId = crypto.randomUUID();
  const safeFileName = sanitiseFileName(input.fileName, assetId);
  const storagePath = `${accountId}/${assetId}/${safeFileName}`;

  const mediaType = deriveMediaType(input.mimeType);

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to create upload URL");
  }

  let derivativeUploadUrls: RequestUploadResult["derivativeUploadUrls"] = undefined;

  if (mediaType === "image") {
    const variants: Record<DerivativeKey, string> = {
      square: `derived/${assetId}/square.jpg`,
      story: `derived/${assetId}/story.jpg`,
      landscape: `derived/${assetId}/landscape.jpg`,
    };

    const uploads: Partial<Record<DerivativeKey, SignedUpload>> = {};
    await Promise.all(
      (Object.entries(variants) as Array<[DerivativeKey, string]>).map(async ([key, path]) => {
        const { data: variantData, error: variantError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUploadUrl(path, { upsert: true });

        if (variantError || !variantData?.signedUrl) {
          console.error("[library] failed to create signed upload url for derivative", {
            assetId,
            variant: key,
            error: variantError,
          });
          return;
        }

        uploads[key] = {
          uploadUrl: variantData.signedUrl,
          storagePath: path,
          contentType: "image/jpeg",
        };
      }),
    );

    if (Object.keys(uploads).length) {
      derivativeUploadUrls = uploads;
    }
  }

  return {
    assetId,
    uploadUrl: data.signedUrl,
    storagePath,
    derivativeUploadUrls,
    mediaType,
  } satisfies RequestUploadResult;
}

interface FinaliseUploadInput {
  assetId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  derivedVariants?: Record<string, string>;
  aspectClass?: "square" | "story" | "landscape";
  tags?: string[];
}

export async function finaliseMediaUpload(input: FinaliseUploadInput) {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  if (!input.storagePath.startsWith(`${accountId}/`)) {
    throw new Error("Storage path does not belong to the authenticated account");
  }

  const mediaType = deriveMediaType(input.mimeType);
  const nowIso = new Date().toISOString();

  const derivedVariants = normaliseDerivedVariants({
    storagePath: input.storagePath,
    derived: input.derivedVariants ?? {},
  });

  const hasImageDerivatives =
    mediaType === "image" && typeof derivedVariants.story === "string" && derivedVariants.story.length > 0;

  const processedStatus: MediaAssetSummary["processedStatus"] =
    mediaType === "image" ? (hasImageDerivatives ? "ready" : "failed") : "ready";
  const tags = normaliseTags(input.tags);

  await supabase
    .from("media_assets")
    .upsert(
      {
        id: input.assetId,
        account_id: accountId,
        storage_path: input.storagePath,
        file_name: input.fileName,
        media_type: mediaType,
        mime_type: input.mimeType,
        size_bytes: input.size,
        tags,
        processed_status: processedStatus,
        processed_at: processedStatus === "ready" ? nowIso : null,
        derived_variants: derivedVariants,
        ...(input.aspectClass ? { aspect_class: input.aspectClass } : {}),
      },
      { onConflict: "id" },
    )
    .throwOnError();

  // Sync to media_library so v2 content_media_attachments FK is satisfied
  try {
    await supabase
      .from("media_library")
      .upsert(
        {
          id: input.assetId,
          account_id: accountId,
          file_name: input.fileName,
          file_url: input.storagePath,
          file_type: input.mimeType,
          file_size_bytes: input.size,
          tags,
        },
        { onConflict: "id" },
      );
  } catch {
    // media_library sync is non-blocking — table may not exist yet
  }

  const { data: assetRow } = await supabase
    .from("media_assets")
    .select(
      "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants, aspect_class",
    )
    .eq("id", input.assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  revalidatePath("/library");
  revalidatePath("/create");

  if (!assetRow) {
    return null;
  }

  const { url: previewUrl, shape: previewShape } = await signPreviewFromCandidates(
    supabase,
    resolvePreviewCandidates({
      storagePath: assetRow.storage_path,
      derivedVariants: assetRow.derived_variants ?? {},
      aspectClass: assetRow.aspect_class,
      placement: "feed",
    }),
  );

  return mapToSummary(assetRow, previewUrl, previewShape);
}

function normaliseDerivedVariants({
  storagePath,
  derived,
}: {
  storagePath: string;
  derived: Record<string, string>;
}) {
  const result: Record<string, string> = {
    original: storagePath,
  };

  for (const [key, value] of Object.entries(derived)) {
    if (typeof value === "string" && value.length) {
      result[key] = value;
    }
  }

  return result;
}

interface UpdateMediaAssetInput {
  assetId: string;
  fileName?: string;
  tags?: string[];
}

export async function updateMediaAsset(input: UpdateMediaAssetInput) {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const trimmedName = input.fileName?.trim();
  const normalisedTags = preserveSystemTags({
    currentTags: await fetchMediaAssetTags({ supabase, accountId, assetId: input.assetId }),
    requestedTags: input.tags,
  });

  const updates: Record<string, unknown> = {
    tags: normalisedTags,
  };

  if (trimmedName && trimmedName.length) {
    updates.file_name = trimmedName;
  }

  await supabase
    .from("media_assets")
    .update(updates)
    .eq("id", input.assetId)
    .eq("account_id", accountId)
    .throwOnError();

  const { data: assetRow } = await supabase
    .from("media_assets")
    .select(
      "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants, aspect_class",
    )
    .eq("id", input.assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  revalidatePath("/library");
  revalidatePath("/create");

  if (!assetRow) {
    return null;
  }

  const { url: previewUrl, shape: previewShape } = await signPreviewFromCandidates(
    supabase,
    resolvePreviewCandidates({
      storagePath: assetRow.storage_path,
      derivedVariants: assetRow.derived_variants ?? {},
      aspectClass: assetRow.aspect_class,
      placement: "feed",
    }),
  );

  return mapToSummary(assetRow, previewUrl, previewShape);
}

async function fetchMediaAssetTags({
  supabase,
  accountId,
  assetId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  assetId: string;
}) {
  const { data } = await supabase
    .from("media_assets")
    .select("tags")
    .eq("id", assetId)
    .eq("account_id", accountId)
    .maybeSingle<{ tags: string[] | null }>();

  return data?.tags ?? [];
}

function preserveSystemTags({
  currentTags,
  requestedTags,
}: {
  currentTags: string[] | null | undefined;
  requestedTags: string[] | null | undefined;
}) {
  const userTags = normaliseTags(requestedTags);
  const existingSystemTags = normaliseTags(currentTags)
    .filter((tag) => (SYSTEM_MEDIA_TAGS as readonly string[]).includes(tag));
  return normaliseTags([...userTags, ...existingSystemTags]);
}

interface DeleteMediaAssetInput {
  assetId: string;
}

type DeleteMediaAssetResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "in_use"; reason: "campaign" | "content" };

type DeleteMediaAssetAttempt = DeleteMediaAssetResult & { assetId: string; fileName?: string };

export type BulkDeleteMediaAssetsResult = {
  deleted: Array<{ assetId: string; fileName?: string }>;
  inUse: Array<{ assetId: string; reason: "campaign" | "content"; fileName?: string }>;
  notFound: string[];
  errors: Array<{ assetId: string; message: string }>;
};

export type HideMediaAssetsResult = {
  hiddenIds: string[];
  notFound: string[];
};

export type HideByTagResult = HideMediaAssetsResult & {
  tag: string;
  matchedCount: number;
};

export async function deleteMediaAsset(input: DeleteMediaAssetInput): Promise<DeleteMediaAssetResult> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const result = await deleteAssetRecord({ supabase, accountId, assetId: input.assetId });

  if (result.status === "deleted") {
    for (const path of REVALIDATE_PATHS) {
      revalidatePath(path);
    }
  }

  return result;
}

export async function bulkDeleteMediaAssets(input: { assetIds: string[] }): Promise<BulkDeleteMediaAssetsResult> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  return performBulkDeletion({
    supabase,
    accountId,
    assetIds: input.assetIds,
    revalidatePaths: REVALIDATE_PATHS,
  });
}

export async function hideMediaAssets(input: { assetIds: string[] }): Promise<HideMediaAssetsResult> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  return performBulkHide({
    supabase,
    accountId,
    assetIds: input.assetIds,
    revalidatePaths: REVALIDATE_PATHS,
  });
}

export async function hideMediaAssetsByTag(tag: string): Promise<HideByTagResult> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const normalisedTag = normaliseTag(tag);

  if (!normalisedTag) {
    throw new Error("Tag is required to hide assets by hashtag.");
  }

  const assetIds = await listAssetIdsByNormalisedTag({ supabase, accountId, normalisedTag });

  const result = await performBulkHide({
    supabase,
    accountId,
    assetIds: Array.from(assetIds),
    revalidatePaths: REVALIDATE_PATHS,
  });

  return { ...result, tag: normalisedTag, matchedCount: assetIds.size };
}

export async function replaceMediaAssetEverywhere(input: { oldAssetId: string; newAssetId: string }) {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const oldAssetId = input.oldAssetId?.trim();
  const newAssetId = input.newAssetId?.trim();

  if (!oldAssetId || !newAssetId) {
    throw new Error("Both original and replacement media are required.");
  }
  if (oldAssetId === newAssetId) {
    throw new Error("Choose a different replacement image.");
  }

  const { data: assetRows, error: assetError } = await supabase
    .from("media_assets")
    .select(
      "id, account_id, storage_path, file_name, media_type, mime_type, size_bytes, tags, processed_status, processed_at, derived_variants, aspect_class",
    )
    .eq("account_id", accountId)
    .in("id", [oldAssetId, newAssetId])
    .returns<ReplacementMediaAssetRow[]>();

  if (assetError) {
    throw assetError;
  }

  const oldAsset = assetRows?.find((asset) => asset.id === oldAssetId) ?? null;
  const newAsset = assetRows?.find((asset) => asset.id === newAssetId) ?? null;

  if (!oldAsset) {
    throw new Error("Original media was not found for this account.");
  }
  if (!newAsset) {
    throw new Error("Replacement media was not found for this account.");
  }
  if (oldAsset.media_type !== "image" || newAsset.media_type !== "image") {
    throw new Error("Only image assets can be replaced with this flow.");
  }
  if (newAsset.processed_status !== "ready") {
    throw new Error("Replacement image is still processing. Try again once ready.");
  }

  await syncReplacementAssetToMediaLibrary({ supabase, accountId, asset: newAsset });

  const nowIso = new Date().toISOString();

  const variants = await replaceContentVariantMediaIds({ supabase, accountId, oldAssetId, newAssetId });
  const attachments = await replaceContentMediaAttachments({ supabase, accountId, oldAssetId, newAssetId });

  const campaigns = await runMutationReturningCount(
    supabase
      .from("campaigns")
      .update({ hero_media_id: newAssetId, updated_at: nowIso })
      .eq("account_id", accountId)
      .eq("hero_media_id", oldAssetId)
      .select("id"),
  );

  const linkInBioProfiles = await runMutationReturningCount(
    supabase
      .from("link_in_bio_profiles")
      .update({ hero_media_id: newAssetId, hero_image_url: null, updated_at: nowIso })
      .eq("account_id", accountId)
      .eq("hero_media_id", oldAssetId)
      .select("id"),
  );

  const linkInBioTiles = await runMutationReturningCount(
    supabase
      .from("link_in_bio_tiles")
      .update({ media_asset_id: newAssetId, image_url: null, updated_at: nowIso })
      .eq("account_id", accountId)
      .eq("media_asset_id", oldAssetId)
      .select("id"),
  );

  const tournamentsSquare = await runMutationReturningCount(
    supabase
      .from("tournaments")
      .update({ base_image_square_id: newAssetId, updated_at: nowIso })
      .eq("account_id", accountId)
      .eq("base_image_square_id", oldAssetId)
      .select("id"),
  );

  const tournamentsStory = await runMutationReturningCount(
    supabase
      .from("tournaments")
      .update({ base_image_story_id: newAssetId, updated_at: nowIso })
      .eq("account_id", accountId)
      .eq("base_image_story_id", oldAssetId)
      .select("id"),
  );

  const meta = await replaceMetaCampaignMediaReferences({ supabase, accountId, oldAssetId, newAssetId });
  const updatedReferences =
    variants +
    attachments.updated +
    attachments.deduped +
    campaigns +
    linkInBioProfiles +
    linkInBioTiles +
    tournamentsSquare +
    tournamentsStory +
    meta.adSets +
    meta.ads;

  // Only hide the old asset once we have verified no planned-post surface still
  // references it, and only after at least one reference was actually changed.
  // Hiding too early is what made stale references invisible and hard to repair.
  const remainingReferences = await countRemainingPlannedPostReferences({ supabase, accountId, oldAssetId });
  const hidden = updatedReferences > 0 && remainingReferences === 0;

  if (hidden) {
    await runMutation(
      supabase
        .from("media_assets")
        .update({ hidden_at: nowIso })
        .eq("account_id", accountId)
        .eq("id", oldAssetId),
    );
  }

  for (const path of REVALIDATE_PATHS) {
    revalidatePath(path);
  }

  return {
    status: hidden
      ? ("replaced" as const)
      : updatedReferences > 0
        ? ("replaced_with_remaining_references" as const)
        : ("replacement_has_no_references" as const),
    oldAssetId,
    newAssetId,
    counts: {
      variants,
      attachments: attachments.updated,
      attachmentsDeduped: attachments.deduped,
      campaigns,
      linkInBioProfiles,
      linkInBioTiles,
      tournamentsSquare,
      tournamentsStory,
      adSets: meta.adSets,
      ads: meta.ads,
    },
    hidden,
    updatedReferences,
    remainingReferences,
  };
}

async function syncReplacementAssetToMediaLibrary({
  supabase,
  accountId,
  asset,
}: {
  supabase: SupabaseClient;
  accountId: string;
  asset: ReplacementMediaAssetRow;
}) {
  await runMutation(
    supabase
      .from("media_library")
      .upsert(
        {
          id: asset.id,
          account_id: accountId,
          file_name: asset.file_name,
          file_url: asset.storage_path,
          file_type: asset.mime_type ?? "image/jpeg",
          file_size_bytes: asset.size_bytes,
          tags: normaliseTags(asset.tags),
        },
        { onConflict: "id" },
      ),
  );
}

async function replaceContentVariantMediaIds({
  supabase,
  accountId,
  oldAssetId,
  newAssetId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  oldAssetId: string;
  newAssetId: string;
}): Promise<number> {
  const { data, error } = await supabase
    .from("content_variants")
    .select("id, media_ids, content_items!inner(account_id)")
    .eq("content_items.account_id", accountId)
    .contains("media_ids", [oldAssetId])
    .returns<ContentVariantMediaRow[]>();

  if (error) {
    throw error;
  }

  let updated = 0;
  for (const variant of data ?? []) {
    const mediaIds = variant.media_ids ?? [];
    const nextMediaIds = replaceMediaIdList(mediaIds, oldAssetId, newAssetId);
    if (nextMediaIds === mediaIds) {
      continue;
    }

    await runMutation(
      supabase
        .from("content_variants")
        .update({ media_ids: nextMediaIds })
        .eq("id", variant.id),
    );
    updated += 1;
  }

  return updated;
}

async function replaceContentMediaAttachments({
  supabase,
  accountId,
  oldAssetId,
  newAssetId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  oldAssetId: string;
  newAssetId: string;
}): Promise<{ updated: number; deduped: number }> {
  const { data, error } = await supabase
    .from("content_media_attachments")
    .select("id, content_item_id, content_items!inner(account_id)")
    .eq("media_id", oldAssetId)
    .eq("content_items.account_id", accountId)
    .returns<AttachmentRow[]>();

  if (error) {
    throw error;
  }

  const oldRows = data ?? [];
  if (!oldRows.length) {
    return { updated: 0, deduped: 0 };
  }

  const contentItemIds = Array.from(new Set(oldRows.map((row) => row.content_item_id)));

  // Content items that already have the new asset attached: re-pointing the old
  // row would violate UNIQUE (content_item_id, media_id), so remove those old
  // rows instead of updating them. This is the collision that previously threw
  // mid-sequence and left posts half-migrated.
  const { data: existingNew, error: existingError } = await supabase
    .from("content_media_attachments")
    .select("content_item_id")
    .eq("media_id", newAssetId)
    .in("content_item_id", contentItemIds)
    .returns<{ content_item_id: string }[]>();

  if (existingError) {
    throw existingError;
  }

  const collidingItemIds = new Set((existingNew ?? []).map((row) => row.content_item_id));
  const idsToDelete = oldRows.filter((row) => collidingItemIds.has(row.content_item_id)).map((row) => row.id);
  const idsToUpdate = oldRows.filter((row) => !collidingItemIds.has(row.content_item_id)).map((row) => row.id);

  if (idsToDelete.length) {
    await runMutation(
      supabase
        .from("content_media_attachments")
        .delete()
        .in("id", idsToDelete),
    );
  }

  if (idsToUpdate.length) {
    await runMutation(
      supabase
        .from("content_media_attachments")
        .update({ media_id: newAssetId })
        .in("id", idsToUpdate),
    );
  }

  return { updated: idsToUpdate.length, deduped: idsToDelete.length };
}

async function countRemainingPlannedPostReferences({
  supabase,
  accountId,
  oldAssetId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  oldAssetId: string;
}): Promise<number> {
  const { data: variantRows, error: variantError } = await supabase
    .from("content_variants")
    .select("id, content_items!inner(account_id)")
    .eq("content_items.account_id", accountId)
    .contains("media_ids", [oldAssetId])
    .returns<IdRow[]>();

  if (variantError) {
    throw variantError;
  }

  const { data: attachmentRows, error: attachmentError } = await supabase
    .from("content_media_attachments")
    .select("id, content_items!inner(account_id)")
    .eq("media_id", oldAssetId)
    .eq("content_items.account_id", accountId)
    .returns<IdRow[]>();

  if (attachmentError) {
    throw attachmentError;
  }

  return (variantRows?.length ?? 0) + (attachmentRows?.length ?? 0);
}

async function replaceMetaCampaignMediaReferences({
  supabase,
  accountId,
  oldAssetId,
  newAssetId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  oldAssetId: string;
  newAssetId: string;
}): Promise<{ adSets: number; ads: number }> {
  const { data: campaignRows, error: campaignError } = await supabase
    .from("meta_campaigns")
    .select("id")
    .eq("account_id", accountId)
    .returns<IdRow[]>();

  if (campaignError) {
    throw campaignError;
  }

  const campaignIds = (campaignRows ?? []).map((row) => row.id);
  if (!campaignIds.length) {
    return { adSets: 0, ads: 0 };
  }

  const { data: adSetRows, error: adSetError } = await supabase
    .from("ad_sets")
    .select("id")
    .in("campaign_id", campaignIds)
    .returns<IdRow[]>();

  if (adSetError) {
    throw adSetError;
  }

  const adSets = await runMutationReturningCount(
    supabase
      .from("ad_sets")
      .update({ adset_media_asset_id: newAssetId, adset_image_url: null })
      .in("campaign_id", campaignIds)
      .eq("adset_media_asset_id", oldAssetId)
      .select("id"),
  );

  const adSetIds = (adSetRows ?? []).map((row) => row.id);
  if (!adSetIds.length) {
    return { adSets, ads: 0 };
  }

  const ads = await runMutationReturningCount(
    supabase
      .from("ads")
      .update({ media_asset_id: newAssetId, preview_url: null })
      .in("adset_id", adSetIds)
      .eq("media_asset_id", oldAssetId)
      .select("id"),
  );

  return { adSets, ads };
}

function replaceMediaIdList(mediaIds: string[], oldAssetId: string, newAssetId: string) {
  let changed = false;
  const next: string[] = [];

  for (const mediaId of mediaIds) {
    const replacement = mediaId === oldAssetId ? newAssetId : mediaId;
    if (replacement !== mediaId) {
      changed = true;
    }
    if (replacement && !next.includes(replacement)) {
      next.push(replacement);
    }
  }

  return changed ? next : mediaIds;
}

async function runMutation(resultPromise: PromiseLike<{ error?: unknown }>) {
  const { error } = await resultPromise;
  if (error) {
    throw error;
  }
}

async function runMutationReturningCount(
  resultPromise: PromiseLike<{ data?: unknown; error?: unknown }>,
): Promise<number> {
  const { data, error } = await resultPromise;
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data.length : 0;
}

async function performBulkHide({
  supabase,
  accountId,
  assetIds,
  revalidatePaths = [],
}: {
  supabase: SupabaseClient;
  accountId: string;
  assetIds: string[];
  revalidatePaths?: readonly string[];
}): Promise<HideMediaAssetsResult> {
  const uniqueIds = Array.from(new Set(assetIds.filter((id) => typeof id === "string" && id.trim().length)));

  if (!uniqueIds.length) {
    return { hiddenIds: [], notFound: [] };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("media_assets")
    .update({ hidden_at: nowIso })
    .eq("account_id", accountId)
    .in("id", uniqueIds)
    .select("id");

  if (error) {
    throw error;
  }

  const hiddenIds = (data ?? []).map((row) => row.id);
  const hiddenIdSet = new Set(hiddenIds);
  const notFound = uniqueIds.filter((id) => !hiddenIdSet.has(id));

  if (hiddenIds.length && revalidatePaths.length) {
    for (const path of revalidatePaths) {
      revalidatePath(path);
    }
  }

  return { hiddenIds, notFound };
}

async function listAssetIdsByNormalisedTag({
  supabase,
  accountId,
  normalisedTag,
}: {
  supabase: SupabaseClient;
  accountId: string;
  normalisedTag: string;
}): Promise<Set<string>> {
  const assetIds = new Set<string>();
  const pageSize = 200;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("media_assets")
      .select("id, tags")
      .eq("account_id", accountId)
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    if (!data?.length) {
      break;
    }

    for (const row of data as Array<{ id: string; tags: string[] | null }>) {
      const tags = row.tags ?? [];
      if (tags.some((storedTag) => normaliseTag(storedTag) === normalisedTag)) {
        assetIds.add(row.id);
      }
    }

    if (data.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return assetIds;
}

async function performBulkDeletion({
  supabase,
  accountId,
  assetIds,
  revalidatePaths = [],
}: {
  supabase: SupabaseClient;
  accountId: string;
  assetIds: string[];
  revalidatePaths?: readonly string[];
}): Promise<BulkDeleteMediaAssetsResult> {
  const uniqueIds = Array.from(new Set(assetIds.filter((id) => typeof id === "string" && id.trim().length)));

  const summary: BulkDeleteMediaAssetsResult = {
    deleted: [],
    inUse: [],
    notFound: [],
    errors: [],
  };

  if (!uniqueIds.length) {
    return summary;
  }

  for (const assetId of uniqueIds) {
    try {
      const result = await deleteAssetRecord({ supabase, accountId, assetId });
      if (result.status === "deleted") {
        summary.deleted.push({ assetId: result.assetId, fileName: result.fileName });
      } else if (result.status === "in_use") {
        summary.inUse.push({ assetId: result.assetId, reason: result.reason, fileName: result.fileName });
      } else {
        summary.notFound.push(result.assetId);
      }
    } catch (error) {
      summary.errors.push({
        assetId,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (summary.deleted.length && revalidatePaths.length) {
    for (const path of revalidatePaths) {
      revalidatePath(path);
    }
  }

  return summary;
}

async function deleteAssetRecord({
  supabase,
  accountId,
  assetId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  assetId: string;
}): Promise<DeleteMediaAssetAttempt> {
  const { data: assetRow, error: fetchError } = await supabase
    .from("media_assets")
    .select("id, account_id, storage_path, derived_variants, file_name")
    .eq("id", assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!assetRow) {
    return { status: "not_found", assetId };
  }

  const fileName = assetRow.file_name ?? undefined;

  const { data: campaignRef } = await supabase
    .from("campaigns")
    .select("id")
    .eq("account_id", accountId)
    .eq("hero_media_id", assetId)
    .limit(1)
    .maybeSingle();

  if (campaignRef) {
    return { status: "in_use", reason: "campaign", assetId, fileName };
  }

  const { data: variantRef } = await supabase
    .from("content_variants")
    .select("id, content_items!inner(account_id, status)")
    .eq("content_items.account_id", accountId)
    .in("content_items.status", ["draft", "scheduled", "queued", "publishing"])
    .contains("media_ids", [assetId])
    .limit(1)
    .maybeSingle();

  if (variantRef) {
    return { status: "in_use", reason: "content", assetId, fileName };
  }

  const storagePaths = new Set<string>();
  const primaryPath = normaliseStoragePath(assetRow.storage_path);
  if (primaryPath) {
    storagePaths.add(primaryPath);
  }

  const derived = (assetRow.derived_variants ?? {}) as Record<string, string>;
  for (const variantPath of Object.values(derived)) {
    const normalised = normaliseStoragePath(variantPath);
    if (normalised) {
      storagePaths.add(normalised);
    }
  }

  if (storagePaths.size) {
    const { error: storageError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .remove(Array.from(storagePaths));
    if (storageError) {
      console.error(`[library] failed to delete storage objects for ${assetId}`, storageError);
    }
  }

  await supabase
    .from("media_assets")
    .delete()
    .eq("id", assetId)
    .eq("account_id", accountId)
    .throwOnError();

  return { status: "deleted", assetId, fileName };
}

async function ensureBucketExists(supabase = createServiceSupabaseClient()) {
  const { data: bucket } = await supabase.storage.getBucket(MEDIA_BUCKET);
  const fileSizeLimit = 5 * 1024 * 1024;

  if (bucket) {
    const { error: updateError } = await supabase.storage.updateBucket(MEDIA_BUCKET, {
      public: false,
      fileSizeLimit,
      allowedMimeTypes: ["image/*", "video/*"],
    });
    if (updateError) {
      throw updateError;
    }
    return;
  }

  const { error } = await supabase.storage.createBucket(MEDIA_BUCKET, {
    public: false,
    fileSizeLimit,
    allowedMimeTypes: ["image/*", "video/*"],
  });

  if (error) {
    throw error;
  }
}

function sanitiseFileName(fileName: string, fallbackId: string) {
  const cleaned = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || `${fallbackId}`;
}

function deriveMediaType(mime: string): MediaType {
  return mime.startsWith("video") ? "video" : "image";
}

async function signPreviewFromCandidates(
  supabase: SupabaseClient,
  candidates: PreviewCandidate[],
): Promise<{ url?: string; shape: "square" | "story" }> {
  for (const candidate of candidates) {
    try {
      const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(candidate.path, 600);
      if (!error && data?.signedUrl) {
        return { url: data.signedUrl, shape: candidate.shape };
      }
    } catch (error) {
      console.error("[library] failed to sign preview candidate", {
        path: candidate.path,
        error,
      });
    }
  }

  return { url: undefined, shape: "square" };
}

function mapToSummary(
  row: {
    id: string;
    file_name: string | null;
    media_type: "image" | "video";
    tags?: string[] | null;
    uploaded_at: string;
    size_bytes: number | null;
    storage_path: string;
    processed_status: "pending" | "processing" | "ready" | "failed" | "skipped" | null;
    processed_at: string | null;
    derived_variants: Record<string, string> | null;
    aspect_class?: "square" | "story" | "landscape" | null;
  },
  previewUrl?: string,
  previewShape: "square" | "story" = "square",
): MediaAssetSummary {
  return {
    id: row.id,
    fileName: row.file_name ?? row.id,
    mediaType: row.media_type,
    tags: normaliseTags(row.tags),
    uploadedAt: row.uploaded_at,
    sizeBytes: row.size_bytes ?? undefined,
    storagePath: row.storage_path,
    processedStatus: (row.processed_status ?? "pending") as MediaAssetSummary["processedStatus"],
    processedAt: row.processed_at ?? undefined,
    derivedVariants: row.derived_variants ?? {},
    aspectClass: (row.aspect_class ?? "square") as MediaAssetSummary["aspectClass"],
    previewUrl,
    previewShape,
  };
}

export async function fetchMediaAssetPreviewUrl(assetId: string) {
  const { supabase, accountId } = await requireAuthContext();

  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("storage_path, derived_variants, aspect_class")
    .eq("id", assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!asset) {
    return null;
  }

  const { url } = await signPreviewFromCandidates(
    supabase,
    resolvePreviewCandidates({
      storagePath: asset.storage_path,
      derivedVariants: asset.derived_variants ?? {},
      aspectClass: asset.aspect_class,
      placement: "feed",
    }),
  );

  return url ?? null;
}

export async function fetchMediaAssetOriginalUrl(assetId: string) {
  const { supabase, accountId } = await requireAuthContext();

  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("storage_path, derived_variants")
    .eq("id", assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!asset) {
    return null;
  }

  const derived = asset.derived_variants ?? {};
  const originalPath = normaliseStoragePath(
    typeof derived.original === "string" && derived.original.length ? derived.original : asset.storage_path,
  );

  if (!originalPath) {
    return null;
  }

  const { data, error: signError } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(originalPath, 600);
  if (signError) {
    console.error("[library] failed to sign original asset", { assetId, error: signError });
    return null;
  }

  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Backfill: classify aspect_class for existing images from their binary headers
// ---------------------------------------------------------------------------

function parseImageDimensions(buf: Uint8Array): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR — width at bytes 16-19, height at 20-23
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    const view = new DataView(buf.buffer, buf.byteOffset);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: scan for SOF0/SOF1/SOF2 markers
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
      }
      if (marker === 0xd9 || marker === 0xda) break;
      i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
    }
  }
  return null;
}

function deriveAspectClass(width: number, height: number): "square" | "story" | "landscape" {
  const r = width / height;
  if (r < 0.7) return "story";
  if (r > 1.3) return "landscape";
  return "square";
}

export async function backfillMediaAspectClass(): Promise<{ updated: number; failed: number }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: assets } = await supabase
    .from("media_assets")
    .select("id, storage_path")
    .eq("account_id", accountId)
    .eq("media_type", "image")
    .eq("processed_status", "ready");

  if (!assets?.length) return { updated: 0, failed: 0 };

  let updated = 0;
  let failed = 0;

  for (const asset of assets) {
    try {
      const { data: signed } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(asset.storage_path, 60);

      if (!signed?.signedUrl) { failed++; continue; }

      const res = await fetch(signed.signedUrl);
      if (!res.ok) { failed++; continue; }

      const buf = new Uint8Array(await res.arrayBuffer());
      const dims = parseImageDimensions(buf);
      const aspectClass = dims ? deriveAspectClass(dims.width, dims.height) : "square";

      await supabase
        .from("media_assets")
        .update({ aspect_class: aspectClass })
        .eq("id", asset.id);

      updated++;
    } catch {
      failed++;
    }
  }

  revalidatePath("/library");
  revalidatePath("/create");

  return { updated, failed };
}
