/**
 * Building a MediaAssetSummary from a media_assets row, previews signed.
 *
 * Extracted from `src/app/(app)/library/actions.ts` so the artwork importer can
 * hand the wizard exactly the same object the browser upload path produces. The
 * wizard resolves selected media ids against its library list, so an importer
 * that returned only an id would select something with no thumbnail, no story
 * preview and no readiness signal.
 *
 * It has to live outside the actions file rather than simply be exported from
 * it: `'use server'` modules may only export async functions, and `mapToSummary`
 * is synchronous.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { MEDIA_BUCKET } from "@/lib/constants";
import { normaliseTags } from "@/lib/library/tags";
import {
  resolvePreviewCandidates,
  resolveStoryDerivativePath,
  type MediaAssetSummary,
  type PreviewCandidate,
} from "@/lib/library/data";

const PREVIEW_TTL_SECONDS = 600;

export interface MediaAssetSummaryRow {
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
}

export async function signPreviewFromCandidates(
  supabase: SupabaseClient,
  candidates: PreviewCandidate[],
): Promise<{ url?: string; shape: "square" | "story" }> {
  for (const candidate of candidates) {
    try {
      const { data, error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(candidate.path, PREVIEW_TTL_SECONDS);
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

/**
 * Sign the 1080x1920 story derivative specifically. Resolved from
 * derived_variants.story, never from a candidate's shape: shape marks a
 * portrait-looking original as "story" too, and the publish worker requires the
 * derivative itself. Returns undefined when there is no derivative, because
 * falling back to an original or square crop would silently promise a story
 * crop that does not exist.
 */
export async function signStoryPreview(
  supabase: SupabaseClient,
  derivedVariants: Record<string, string> | null | undefined,
): Promise<string | undefined> {
  const storyPath = resolveStoryDerivativePath(derivedVariants);

  if (!storyPath) {
    return undefined;
  }

  try {
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(storyPath, PREVIEW_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  } catch (error) {
    console.error("[library] failed to sign story preview", {
      path: storyPath,
      error,
    });
  }

  return undefined;
}

export function mapToSummary(
  row: MediaAssetSummaryRow,
  previewUrl?: string,
  previewShape: "square" | "story" = "square",
  storyPreviewUrl?: string,
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
    storyPreviewUrl,
    previewShape,
  };
}

/** The column list every summary caller needs. Kept here so they cannot drift. */
export const MEDIA_ASSET_SUMMARY_COLUMNS =
  "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants, aspect_class";

/** Load one asset and sign its feed and story previews. Account-scoped. */
export async function loadMediaAssetSummary(
  supabase: SupabaseClient,
  accountId: string,
  assetId: string,
): Promise<MediaAssetSummary | null> {
  const { data } = await supabase
    .from("media_assets")
    .select(MEDIA_ASSET_SUMMARY_COLUMNS)
    .eq("id", assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as MediaAssetSummaryRow;

  const candidates = resolvePreviewCandidates({
    storagePath: row.storage_path,
    derivedVariants: row.derived_variants ?? {},
    aspectClass: row.aspect_class ?? "square",
    placement: "feed",
  });

  const { url: previewUrl, shape: previewShape } = await signPreviewFromCandidates(supabase, candidates);
  const storyPreviewUrl = await signStoryPreview(supabase, row.derived_variants);

  return mapToSummary(row, previewUrl, previewShape, storyPreviewUrl);
}
