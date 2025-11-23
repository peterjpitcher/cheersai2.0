import { requireAuthContext } from "@/lib/auth/server";
import { MEDIA_BUCKET } from "@/lib/constants";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export interface MediaAssetSummary {
  id: string;
  fileName: string;
  mediaType: "image" | "video";
  tags: string[];
  uploadedAt: string;
  sizeBytes?: number;
  storagePath: string;
  processedStatus: "pending" | "processing" | "ready" | "failed" | "skipped";
  processedAt?: string;
  derivedVariants: Record<string, string>;
  previewUrl?: string;
  previewShape: "square" | "story";
}

type MediaAssetRow = {
  id: string;
  file_name: string;
  media_type: "image" | "video";
  tags: string[] | null;
  uploaded_at: string;
  size_bytes: number | null;
  storage_path: string;
  processed_status: "pending" | "processing" | "ready" | "failed" | "skipped" | null;
  processed_at: string | null;
  derived_variants: Record<string, string> | null;
};

export async function listMediaAssets(): Promise<MediaAssetSummary[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await supabase
      .from("media_assets")
      .select(
        "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants",
      )
      .eq("account_id", accountId)
      .order("uploaded_at", { ascending: false })
      .limit(100)
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
      processedStatus: (row.processed_status ?? "pending") as MediaAssetSummary["processedStatus"],
      processedAt: row.processed_at ?? undefined,
      derivedVariants: row.derived_variants ?? {},
      previewUrl: undefined,
      previewShape: "square",
    }));

    const previewCandidatesById = new Map<string, PreviewCandidate[]>();
    const requestedPaths = new Set<string>();

    for (const asset of summaries) {
      const candidates = resolvePreviewCandidates({
        storagePath: asset.storagePath,
        derivedVariants: asset.derivedVariants,
      });
      previewCandidatesById.set(asset.id, candidates);
      for (const candidate of candidates) {
        requestedPaths.add(candidate.path);
      }
    }

    const signedUrlMap = new Map<string, string>();

    if (requestedPaths.size) {
      const { data: signed, error: signedError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrls(Array.from(requestedPaths), 600);

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
      const candidates = previewCandidatesById.get(asset.id) ?? [];
      let previewUrl: string | undefined;
      let previewShape: "square" | "story" = "square";

      for (const candidate of candidates) {
        const signedUrl = signedUrlMap.get(candidate.path);
        if (signedUrl) {
          previewUrl = signedUrl;
          previewShape = candidate.shape;
          break;
        }
      }

      return {
        ...asset,
        previewUrl,
        previewShape,
      } satisfies MediaAssetSummary;
    });
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}

const PREVIEW_VARIANT_PRIORITY: Array<{ key: string; shape: "square" | "story" }> = [
  { key: "square", shape: "square" },
  { key: "story", shape: "story" },
  { key: "landscape", shape: "square" },
  { key: "original", shape: "square" },
];

export type PreviewInfo = { path: string; shape: "square" | "story" };
export type PreviewCandidate = PreviewInfo;

export function resolvePreviewCandidates({
  storagePath,
  derivedVariants,
}: {
  storagePath: string;
  derivedVariants: Record<string, string>;
}): PreviewCandidate[] {
  const candidates: PreviewCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (path: string | undefined, shape: PreviewCandidate["shape"]) => {
    if (!path) return;
    const normalised = normaliseStoragePath(path);
    if (!normalised || seen.has(normalised)) return;
    seen.add(normalised);
    candidates.push({ path: normalised, shape });
  };

  for (const variant of PREVIEW_VARIANT_PRIORITY) {
    addCandidate(derivedVariants?.[variant.key], variant.shape);
  }

  addCandidate(storagePath, /story|portrait|9x16|9-16/i.test(storagePath) ? "story" : "square");

  return candidates;
}

export function resolvePreviewInfo({
  storagePath,
  derivedVariants,
}: {
  storagePath: string;
  derivedVariants: Record<string, string>;
}): PreviewInfo | null {
  const [first] = resolvePreviewCandidates({ storagePath, derivedVariants });
  return first ?? null;
}

export function normaliseStoragePath(path: string) {
  if (!path) return path;
  if (path.startsWith(`${MEDIA_BUCKET}/`)) {
    return path.slice(MEDIA_BUCKET.length + 1);
  }
  return path;
}
