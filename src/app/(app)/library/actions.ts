"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { MEDIA_BUCKET, OWNER_ACCOUNT_ID } from "@/lib/constants";
import { ensureOwnerAccount } from "@/lib/supabase/owner";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { MediaAssetSummary } from "@/lib/library/data";
import { resolvePreviewInfo, normaliseStoragePath } from "@/lib/library/data";

interface RequestUploadInput {
  fileName: string;
  mimeType: string;
  size: number;
}

export async function requestMediaUpload(input: RequestUploadInput) {
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  await ensureBucketExists(supabase);

  const assetId = crypto.randomUUID();
  const safeFileName = sanitiseFileName(input.fileName, assetId);
  const storagePath = `${OWNER_ACCOUNT_ID}/${assetId}/${safeFileName}`;

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to create upload URL");
  }

  return {
    assetId,
    uploadUrl: data.signedUrl,
    storagePath,
  } as const;
}

interface FinaliseUploadInput {
  assetId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
}

export async function finaliseMediaUpload(input: FinaliseUploadInput) {
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  const mediaType = deriveMediaType(input.mimeType);
  const nowIso = new Date().toISOString();

  await supabase
    .from("media_assets")
    .upsert(
      {
        id: input.assetId,
        account_id: OWNER_ACCOUNT_ID,
        storage_path: input.storagePath,
        file_name: input.fileName,
        media_type: mediaType,
        mime_type: input.mimeType,
        size_bytes: input.size,
        processed_status: 'pending',
        processed_at: null,
        derived_variants: {},
      },
      { onConflict: "id" },
    )
    .throwOnError();

  let enqueueError: unknown = null;
  try {
    const { error: processingError } = await supabase.functions.invoke("media-derivatives", {
      body: { assetId: input.assetId },
    });
    if (processingError) {
      enqueueError = processingError;
    }
  } catch (error) {
    enqueueError = error;
  }

  if (enqueueError) {
    console.error("[library] failed to enqueue media derivatives", enqueueError);
    const fallbackStatus = mediaType === "image" ? "ready" : "skipped";
    const fallbackVariants = mediaType === "image" ? { original: input.storagePath } : {};

    await supabase
      .from("media_assets")
      .update({
        processed_status: fallbackStatus,
        processed_at: nowIso,
        derived_variants: fallbackVariants,
      })
      .eq("id", input.assetId)
      .throwOnError();
  }

  const { data: assetRow } = await supabase
    .from("media_assets")
    .select(
      "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants",
    )
    .eq("id", input.assetId)
    .maybeSingle();

  revalidatePath("/library");
  revalidatePath("/create");

  if (!assetRow) {
    return null;
  }

  const previewInfo = resolvePreviewInfo({
    storagePath: assetRow.storage_path,
    derivedVariants: assetRow.derived_variants ?? {},
  });

  let previewUrl: string | undefined;
  if (previewInfo?.path) {
    const { data: signed, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(previewInfo.path, 600);
    if (!error && signed?.signedUrl) {
      previewUrl = signed.signedUrl;
    }
  }

  return mapToSummary(assetRow, previewUrl, previewInfo?.shape ?? 'square');
}

interface UpdateMediaAssetInput {
  assetId: string;
  fileName?: string;
  tags?: string[];
}

export async function updateMediaAsset(input: UpdateMediaAssetInput) {
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  const trimmedName = input.fileName?.trim();
  const normalisedTags = Array.from(
    new Set((input.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0)),
  );

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
    .eq("account_id", OWNER_ACCOUNT_ID)
    .throwOnError();

  const { data: assetRow } = await supabase
    .from("media_assets")
    .select(
      "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants",
    )
    .eq("id", input.assetId)
    .maybeSingle();

  revalidatePath("/library");
  revalidatePath("/create");

  if (!assetRow) {
    return null;
  }

  const previewInfo = resolvePreviewInfo({
    storagePath: assetRow.storage_path,
    derivedVariants: assetRow.derived_variants ?? {},
  });

  let previewUrl: string | undefined;
  if (previewInfo?.path) {
    const { data: signed, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(previewInfo.path, 600);
    if (!error && signed?.signedUrl) {
      previewUrl = signed.signedUrl;
    }
  }

  return mapToSummary(assetRow, previewUrl, previewInfo?.shape ?? 'square');
}


interface DeleteMediaAssetInput {
  assetId: string;
}

type DeleteMediaAssetResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "in_use"; reason: "campaign" | "content" };

export async function deleteMediaAsset(input: DeleteMediaAssetInput): Promise<DeleteMediaAssetResult> {
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  const { data: assetRow, error: fetchError } = await supabase
    .from("media_assets")
    .select("id, account_id, storage_path, derived_variants, file_name")
    .eq("id", input.assetId)
    .eq("account_id", OWNER_ACCOUNT_ID)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!assetRow) {
    return { status: "not_found" };
  }

  const { data: campaignRef } = await supabase
    .from("campaigns")
    .select("id")
    .eq("account_id", OWNER_ACCOUNT_ID)
    .eq("hero_media_id", input.assetId)
    .limit(1)
    .maybeSingle();

  if (campaignRef) {
    return { status: "in_use", reason: "campaign" };
  }

  const { data: variantRef } = await supabase
    .from("content_variants")
    .select("id")
    .contains("media_ids", [input.assetId])
    .limit(1)
    .maybeSingle();

  if (variantRef) {
    return { status: "in_use", reason: "content" };
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
      console.error(`[library] failed to delete storage objects for ${input.assetId}`, storageError);
    }
  }

  await supabase
    .from("media_assets")
    .delete()
    .eq("id", input.assetId)
    .eq("account_id", OWNER_ACCOUNT_ID)
    .throwOnError();

  revalidatePath("/library");
  revalidatePath("/create");
  revalidatePath("/planner");

  return { status: "deleted" };
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

function deriveMediaType(mime: string) {
  return mime.startsWith("video") ? "video" : "image";
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
    processed_status: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped' | null;
    processed_at: string | null;
    derived_variants: Record<string, string> | null;
  },
  previewUrl?: string,
  previewShape: 'square' | 'story' = 'square',
): MediaAssetSummary {
  return {
    id: row.id,
    fileName: row.file_name ?? row.id,
    mediaType: row.media_type,
    tags: row.tags ?? [],
    uploadedAt: row.uploaded_at,
    sizeBytes: row.size_bytes ?? undefined,
    storagePath: row.storage_path,
    processedStatus: (row.processed_status ?? 'pending') as MediaAssetSummary['processedStatus'],
    processedAt: row.processed_at ?? undefined,
    derivedVariants: row.derived_variants ?? {},
    previewUrl,
    previewShape,
  };
}
