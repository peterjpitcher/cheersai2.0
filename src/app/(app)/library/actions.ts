"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAuthContext } from "@/lib/auth/server";
import { MEDIA_BUCKET } from "@/lib/constants";
import { normaliseTag, normaliseTags } from "@/lib/library/tags";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { MediaAssetSummary } from "@/lib/library/data";
import { resolvePreviewCandidates, normaliseStoragePath, type PreviewCandidate } from "@/lib/library/data";

const REVALIDATE_PATHS = ["/library", "/create", "/planner"] as const;

interface RequestUploadInput {
  fileName: string;
  mimeType: string;
  size: number;
}

type MediaType = "image" | "video";

type DerivativeKey = "story" | "square" | "landscape";

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
        processed_status: processedStatus,
        processed_at: processedStatus === "ready" ? nowIso : null,
        derived_variants: derivedVariants,
      },
      { onConflict: "id" },
    )
    .throwOnError();

  const { data: assetRow } = await supabase
    .from("media_assets")
    .select(
      "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants",
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
  const normalisedTags = normaliseTags(input.tags);

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
      "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants",
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
    }),
  );

  return mapToSummary(assetRow, previewUrl, previewShape);
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
    .select("id, content_items!inner(account_id)")
    .eq("content_items.account_id", accountId)
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
    previewUrl,
    previewShape,
  };
}

export async function fetchMediaAssetPreviewUrl(assetId: string) {
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

  const { url } = await signPreviewFromCandidates(
    supabase,
    resolvePreviewCandidates({
      storagePath: asset.storage_path,
      derivedVariants: asset.derived_variants ?? {},
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
