import { requireAuthContext } from "@/lib/auth/server";
import { MEDIA_BUCKET } from "@/lib/constants";
import { normaliseTags } from "@/lib/library/tags";
import { SYSTEM_MEDIA_TAGS } from "@/lib/library/system-tags";
import { isSchemaMissingError } from "@/lib/supabase/errors";

/** Default cap on how many library assets a single list call returns. */
const DEFAULT_MEDIA_LIBRARY_LIMIT = 100;
/**
 * TTL (seconds) for signed preview URLs. Kept long enough to outlast a typical
 * create/planner session so previews don't silently break mid-flow (the create
 * wizard signs once on open and reuses the list across steps).
 */
const PREVIEW_URL_SIGN_TTL_SECONDS = 60 * 60;

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
  aspectClass: "square" | "story" | "landscape";
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
  aspect_class: "square" | "story" | "landscape" | null;
};

interface ListMediaAssetsOptions {
  excludeTags?: string[];
  includeSystemAssets?: boolean;
  /** Storage path prefixes to exclude (uses SQL LIKE with trailing %) */
  excludeStoragePathPrefixes?: string[];
  /**
   * Max assets to return (newest first). Defaults to {@link DEFAULT_MEDIA_LIBRARY_LIMIT}.
   * Surfaces that let a user pick from a large library (e.g. the create wizard)
   * can raise this so older selections stay resolvable.
   */
  limit?: number;
}

export async function listMediaAssets(
  options: ListMediaAssetsOptions = {},
): Promise<MediaAssetSummary[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    let query = supabase
      .from("media_assets")
      .select(
        "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants, aspect_class",
      )
      .eq("account_id", accountId)
      .is("hidden_at", null);

    const excludeTags = options.includeSystemAssets
      ? options.excludeTags ?? []
      : Array.from(new Set([...(options.excludeTags ?? []), ...SYSTEM_MEDIA_TAGS]));

    if (excludeTags.length) {
      for (const tag of excludeTags) {
        query = query.not("tags", "cs", `{${tag}}`);
      }
      if (excludeTags.includes("Tournament")) {
        query = query.not("storage_path", "like", "tournaments/%");
      }
    }

    if (options.excludeStoragePathPrefixes?.length) {
      for (const prefix of options.excludeStoragePathPrefixes) {
        query = query.not("storage_path", "like", `${prefix}%`);
      }
    }

    const { data, error } = await query
      .order("uploaded_at", { ascending: false })
      .limit(options.limit ?? DEFAULT_MEDIA_LIBRARY_LIMIT)
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
      tags: normaliseTags(row.tags),
      uploadedAt: row.uploaded_at,
      sizeBytes: row.size_bytes ?? undefined,
      storagePath: row.storage_path,
      processedStatus: (row.processed_status ?? "pending") as MediaAssetSummary["processedStatus"],
      processedAt: row.processed_at ?? undefined,
      derivedVariants: row.derived_variants ?? {},
      aspectClass: (row.aspect_class ?? "square") as MediaAssetSummary["aspectClass"],
      previewUrl: undefined,
      previewShape: "square",
    }));

    const previewCandidatesById = new Map<string, PreviewCandidate[]>();
    const requestedPaths = new Set<string>();

    for (const asset of summaries) {
      const candidates = resolvePreviewCandidates({
        storagePath: asset.storagePath,
        derivedVariants: asset.derivedVariants,
        aspectClass: asset.aspectClass,
        placement: "feed",
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
        .createSignedUrls(Array.from(requestedPaths), PREVIEW_URL_SIGN_TTL_SECONDS);

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

export type PreviewPlacement = "feed" | "story";
export type PreviewInfo = { path: string; shape: "square" | "story" };
export type PreviewCandidate = PreviewInfo;

export function orderPreviewCandidatesForPlacement({
  candidates,
  storagePath,
  placement,
}: {
  candidates: PreviewCandidate[];
  storagePath: string;
  placement?: PreviewPlacement | null;
}): PreviewCandidate[] {
  if (placement === "story") {
    return [
      ...candidates.filter((candidate) => candidate.shape === "story"),
      ...candidates.filter((candidate) => candidate.shape !== "story"),
    ];
  }

  if (placement === "feed") {
    const originalPath = normaliseStoragePath(storagePath);
    return [
      ...candidates.filter((candidate) => candidate.path === originalPath),
      ...candidates.filter((candidate) => candidate.path !== originalPath),
    ];
  }

  return candidates;
}

export function resolvePreviewCandidates({
  storagePath,
  derivedVariants,
  aspectClass,
  placement,
}: {
  storagePath: string;
  derivedVariants: Record<string, string>;
  aspectClass?: MediaAssetSummary["aspectClass"] | null;
  placement?: PreviewPlacement | null;
}): PreviewCandidate[] {
  const candidates: PreviewCandidate[] = [];
  const seen = new Set<string>();
  const originalShape = aspectClass === "story" ? "story" : "square";

  const addCandidate = (path: string | undefined, shape: PreviewCandidate["shape"]) => {
    if (!path) return;
    const normalised = normaliseStoragePath(path);
    if (!normalised || seen.has(normalised)) return;
    seen.add(normalised);
    candidates.push({ path: normalised, shape });
  };

  for (const variant of PREVIEW_VARIANT_PRIORITY) {
    addCandidate(derivedVariants?.[variant.key], variant.key === "original" ? originalShape : variant.shape);
  }

  addCandidate(storagePath, /story|portrait|9x16|9-16/i.test(storagePath) ? "story" : originalShape);

  return orderPreviewCandidatesForPlacement({ candidates, storagePath, placement });
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
