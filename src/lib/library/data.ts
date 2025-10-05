import { MEDIA_BUCKET, OWNER_ACCOUNT_ID } from "@/lib/constants";
import { ensureOwnerAccount } from "@/lib/supabase/owner";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export interface MediaAssetSummary {
  id: string;
  fileName: string;
  mediaType: "image" | "video";
  tags: string[];
  uploadedAt: string;
  sizeBytes?: number;
  storagePath: string;
  processedStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped';
  processedAt?: string;
  derivedVariants: Record<string, string>;
  previewUrl?: string;
  previewShape: 'square' | 'story';
}

type MediaAssetRow = {
  id: string;
  file_name: string;
  media_type: "image" | "video";
  tags: string[] | null;
  uploaded_at: string;
  size_bytes: number | null;
  storage_path: string;
  processed_status: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped' | null;
  processed_at: string | null;
  derived_variants: Record<string, string> | null;
};

export async function listMediaAssets(): Promise<MediaAssetSummary[]> {
  await ensureOwnerAccount();
  const supabase = tryCreateServiceSupabaseClient();

  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("media_assets")
      .select(
        "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants",
      )
      .eq("account_id", OWNER_ACCOUNT_ID)
      .order("uploaded_at", { ascending: false })
      .limit(20)
      .returns<MediaAssetRow[]>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return [];
      }
      throw error;
    }

    if (!data?.length) {
      return [];
    }

    const summaries: MediaAssetSummary[] = data.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      mediaType: row.media_type,
      tags: row.tags ?? [],
      uploadedAt: row.uploaded_at,
      sizeBytes: row.size_bytes ?? undefined,
      storagePath: row.storage_path,
      processedStatus: (row.processed_status ?? 'pending') as MediaAssetSummary['processedStatus'],
      processedAt: row.processed_at ?? undefined,
      derivedVariants: row.derived_variants ?? {},
      previewUrl: undefined,
      previewShape: 'square',
    }));

    const previewInfoById = new Map<string, PreviewInfo | null>();
    for (const asset of summaries) {
      previewInfoById.set(
        asset.id,
        resolvePreviewInfo({
          storagePath: asset.storagePath,
          derivedVariants: asset.derivedVariants,
        }),
      );
    }

    const storageClient = supabase.storage;
    const requestedPaths = Array.from(
      new Set(
        Array.from(previewInfoById.values())
          .map((info) => info?.path)
          .filter((path): path is string => Boolean(path)),
      ),
    );

    const signedUrlMap = new Map<string, string>();

    if (storageClient && requestedPaths.length) {
      const { data: signed, error: signedError } = await storageClient
        .from(MEDIA_BUCKET)
        .createSignedUrls(requestedPaths, 600);

      if (signedError) {
        console.error("[library] failed to sign media previews", signedError);
      } else if (signed) {
        for (const entry of signed) {
          if (entry?.path && entry.signedUrl && !entry.error) {
            signedUrlMap.set(entry.path, entry.signedUrl);
          }
        }
      }
    }

    return summaries.map((asset) => {
      const previewInfo = previewInfoById.get(asset.id);
      const previewUrl = previewInfo?.path ? signedUrlMap.get(previewInfo.path) : undefined;

      return {
        ...asset,
        previewUrl,
        previewShape: previewInfo?.shape ?? 'square',
      } satisfies MediaAssetSummary;
    });
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}

const PREVIEW_VARIANT_PRIORITY: Array<{ key: string; shape: 'square' | 'story' }> = [
  { key: 'square', shape: 'square' },
  { key: 'story', shape: 'story' },
  { key: 'landscape', shape: 'square' },
  { key: 'original', shape: 'square' },
];

type PreviewInfo = { path: string; shape: 'square' | 'story' };

export function resolvePreviewInfo({
  storagePath,
  derivedVariants,
}: {
  storagePath: string;
  derivedVariants: Record<string, string>;
}): PreviewInfo | null {
  for (const variant of PREVIEW_VARIANT_PRIORITY) {
    const path = derivedVariants?.[variant.key];
    if (path) {
      return { path: normaliseStoragePath(path), shape: variant.shape };
    }
  }

  if (storagePath) {
    const normalised = normaliseStoragePath(storagePath);
    const inferredShape: 'square' | 'story' = /story|portrait|9x16|9-16/i.test(normalised) ? 'story' : 'square';
    return { path: normalised, shape: inferredShape };
  }

  return null;
}

export function normaliseStoragePath(path: string) {
  if (!path) return path;
  if (path.startsWith(`${MEDIA_BUCKET}/`)) {
    return path.slice(MEDIA_BUCKET.length + 1);
  }
  return path;
}
