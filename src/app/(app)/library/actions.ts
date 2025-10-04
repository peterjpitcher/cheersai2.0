"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { MEDIA_BUCKET, OWNER_ACCOUNT_ID } from "@/lib/constants";
import { ensureOwnerAccount } from "@/lib/supabase/owner";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

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
    .createSignedUploadUrl(storagePath, {
      upsert: true,
    });

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

  await supabase
    .from("media_assets")
    .upsert(
      {
        id: input.assetId,
        account_id: OWNER_ACCOUNT_ID,
        storage_path: input.storagePath,
        file_name: input.fileName,
        media_type: deriveMediaType(input.mimeType),
        mime_type: input.mimeType,
        size_bytes: input.size,
        processed_status: 'pending',
      },
      { onConflict: "id" },
    )
    .throwOnError();

  const { error: processingError } = await supabase.functions.invoke("media-derivatives", {
    body: { assetId: input.assetId },
  });

  if (processingError) {
    console.error("[library] failed to enqueue media derivatives", processingError);
  }

  revalidatePath("/library");
}

async function ensureBucketExists(supabase = createServiceSupabaseClient()) {
  const { data: bucket } = await supabase.storage.getBucket(MEDIA_BUCKET);
  if (bucket) return;

  const { error } = await supabase.storage.createBucket(MEDIA_BUCKET, {
    public: false,
    fileSizeLimit: 1024 * 1024 * 512,
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
