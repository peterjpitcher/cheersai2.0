/**
 * Server-side thumbnail resolver for content items.
 *
 * Resolves thumbnails from both v2 (content_media_attachments) and
 * v1 (content_variants.media_ids) media relationships, using signed
 * Supabase Storage URLs from the media_assets table.
 */

import { MEDIA_BUCKET } from '@/lib/constants';
import { resolvePreviewCandidates } from '@/lib/library/data';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type V2AttachmentRow = {
  content_item_id: string;
  media_id: string;
  position: number;
};

type V1VariantRow = {
  content_item_id: string;
  media_ids: string[] | null;
};

type MediaAssetRow = {
  id: string;
  storage_path: string;
  derived_variants: Record<string, string> | null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve signed thumbnail URLs for a set of content items.
 *
 * Checks v2 attachments first (content_media_attachments, ordered by position),
 * then falls back to v1 relationships (content_variants.media_ids).
 * Signs storage paths via the service-role client.
 *
 * Returns a Map of contentItemId -> signed thumbnail URL.
 * Non-blocking: returns an empty map on any error.
 */
export async function resolveThumbnails(
  contentItemIds: string[],
): Promise<Map<string, string>> {
  if (!contentItemIds.length) return new Map();

  const service = tryCreateServiceSupabaseClient();
  if (!service) return new Map();

  try {
    const anon = await createServerSupabaseClient();

    // Step 1+2: Resolve primary media asset ID per content item
    const mediaIdByContent = await resolveMediaIds(anon, contentItemIds);
    if (!mediaIdByContent.size) return new Map();

    // Step 3: Fetch media_assets for storage paths
    const uniqueAssetIds = [...new Set(mediaIdByContent.values())];
    const { data: assetRows, error: assetError } = await service
      .from('media_assets')
      .select('id, storage_path, derived_variants')
      .in('id', uniqueAssetIds)
      .returns<MediaAssetRow[]>();

    if (assetError) {
      if (isSchemaMissingError(assetError)) return new Map();
      throw assetError;
    }
    if (!assetRows?.length) return new Map();

    // Step 4: Resolve preview candidates per asset
    const candidatesByAsset = new Map<string, string>();
    const uniquePaths = new Set<string>();

    for (const row of assetRows) {
      const candidates = resolvePreviewCandidates({
        storagePath: row.storage_path,
        derivedVariants: row.derived_variants ?? {},
      });
      if (candidates.length > 0) {
        candidatesByAsset.set(row.id, candidates[0].path);
        for (const c of candidates) {
          uniquePaths.add(c.path);
        }
      }
    }

    if (!uniquePaths.size) return new Map();

    // Step 5: Batch-sign all candidate paths
    const { data: signedData, error: signError } = await service.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls([...uniquePaths], 600);

    if (signError || !signedData) return new Map();

    const urlByPath = new Map<string, string>();
    for (const entry of signedData) {
      if (entry?.path && entry.signedUrl && !entry.error) {
        urlByPath.set(entry.path, entry.signedUrl);
      }
    }

    // Step 6: Build contentItemId -> signedUrl map
    const result = new Map<string, string>();
    for (const [contentId, assetId] of mediaIdByContent) {
      const bestPath = candidatesByAsset.get(assetId);
      if (bestPath) {
        const url = urlByPath.get(bestPath);
        if (url) {
          result.set(contentId, url);
        }
      }
    }

    return result;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Internal: resolve primary media asset ID per content item
// ---------------------------------------------------------------------------

async function resolveMediaIds(
  supabase: ReturnType<typeof createServerSupabaseClient> extends Promise<infer T> ? T : never,
  contentItemIds: string[],
): Promise<Map<string, string>> {
  const mediaIdByContent = new Map<string, string>();
  const unresolved = new Set(contentItemIds);

  // Try v2 attachments first (ordered by position)
  try {
    const { data: v2Rows, error: v2Error } = await supabase
      .from('content_media_attachments')
      .select('content_item_id, media_id, position')
      .in('content_item_id', contentItemIds)
      .order('position', { ascending: true })
      .returns<V2AttachmentRow[]>();

    if (!v2Error && v2Rows?.length) {
      for (const row of v2Rows) {
        // First attachment per content item (lowest position) is the thumbnail
        if (!mediaIdByContent.has(row.content_item_id)) {
          mediaIdByContent.set(row.content_item_id, row.media_id);
          unresolved.delete(row.content_item_id);
        }
      }
    }
  } catch {
    // v2 table may not exist — continue to v1 fallback
  }

  if (!unresolved.size) return mediaIdByContent;

  // Fallback: v1 content_variants.media_ids
  try {
    const { data: v1Rows, error: v1Error } = await supabase
      .from('content_variants')
      .select('content_item_id, media_ids')
      .in('content_item_id', [...unresolved])
      .returns<V1VariantRow[]>();

    if (!v1Error && v1Rows?.length) {
      for (const row of v1Rows) {
        const firstId = row.media_ids?.find((id) => Boolean(id));
        if (firstId && !mediaIdByContent.has(row.content_item_id)) {
          mediaIdByContent.set(row.content_item_id, firstId);
        }
      }
    }
  } catch {
    // content_variants may not exist — that's fine
  }

  return mediaIdByContent;
}
