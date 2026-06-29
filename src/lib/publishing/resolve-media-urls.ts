/**
 * Resolve raw Supabase storage paths into short-lived signed URLs (B3).
 * Uses batch signing via createSignedUrls() to minimise API calls.
 *
 * For publish payloads, we need signed URLs because providers (Facebook,
 * Instagram) fetch the media at publish time -- raw storage paths
 * are not publicly accessible.
 *
 * Signed URL TTL: 3600s (1 hour) -- generous window for provider fetch.
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { MEDIA_BUCKET } from '@/lib/constants';

/** TTL in seconds for signed media URLs. 1 hour provides ample window for provider fetch. */
const SIGNED_URL_TTL_SECONDS = 3600;

interface MediaAssetRow {
  id: string;
  storage_path: string;
  derived_variants: Record<string, string> | null;
}

interface ResolveMediaOptions {
  /** Media asset IDs to resolve */
  mediaIds: string[];
  /** Content placement -- determines which derived variant to prefer */
  placement?: 'feed' | 'story';
}

interface ResolvedMedia {
  /** Signed URLs ready for provider consumption */
  signedUrls: string[];
  /** Number of assets that failed to sign (logged but non-blocking) */
  failedCount: number;
}

/**
 * Resolve media asset IDs into signed URLs suitable for publish payloads.
 *
 * Strategy:
 * 1. Load media_assets rows to get storage_path + derived_variants.
 * 2. For each asset, pick the best path based on placement:
 *    - story placement: prefer derived_variants.story if available.
 *    - feed placement: prefer derived_variants.feed, then original.
 *    - Banner-rendered assets will have derived_variants.banner.
 * 3. Batch-sign all chosen paths via createSignedUrls().
 *
 * @returns Signed URLs in the same order as input mediaIds.
 */
export async function resolveMediaUrls(
  options: ResolveMediaOptions,
): Promise<ResolvedMedia> {
  const { mediaIds, placement } = options;

  if (mediaIds.length === 0) {
    return { signedUrls: [], failedCount: 0 };
  }

  const db = createServiceSupabaseClient();

  // Step 1: Load media assets with storage paths and derived variants
  const { data: assets, error: assetsError } = await db
    .from('media_assets')
    .select('id, storage_path, derived_variants')
    .in('id', mediaIds);

  if (assetsError || !assets) {
    return { signedUrls: [], failedCount: mediaIds.length };
  }

  // Build a lookup by ID to preserve input order
  const assetById = new Map<string, MediaAssetRow>();
  for (const asset of assets) {
    assetById.set(
      (asset as MediaAssetRow).id,
      asset as MediaAssetRow,
    );
  }

  // Step 2: Pick the best storage path per asset based on placement
  const orderedPaths: Array<{ mediaId: string; path: string } | null> = mediaIds.map((id) => {
    const asset = assetById.get(id);
    if (!asset) return null;

    const derived = asset.derived_variants ?? {};
    let bestPath = asset.storage_path;

    if (placement === 'story' && typeof derived.story === 'string' && derived.story.length > 0) {
      bestPath = derived.story;
    } else if (placement === 'feed' && typeof derived.feed === 'string' && derived.feed.length > 0) {
      bestPath = derived.feed;
    } else if (typeof derived.banner === 'string' && derived.banner.length > 0) {
      // Banner-rendered media takes precedence for any non-story placement
      bestPath = derived.banner;
    }

    return { mediaId: id, path: normaliseStoragePath(bestPath) };
  });

  // Collect valid paths for batch signing
  const validEntries = orderedPaths.filter(
    (entry): entry is { mediaId: string; path: string } => entry !== null,
  );

  if (validEntries.length === 0) {
    return { signedUrls: [], failedCount: mediaIds.length };
  }

  const pathsToSign = validEntries.map((e) => e.path);

  // Step 3: Batch sign via Supabase storage
  const { data: signedData, error: signError } = await db.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(pathsToSign, SIGNED_URL_TTL_SECONDS);

  if (signError || !signedData) {
    return { signedUrls: [], failedCount: mediaIds.length };
  }

  // Build path -> signedUrl lookup
  const signedUrlByPath = new Map<string, string>();
  for (const entry of signedData) {
    if (entry?.path && entry.signedUrl && !entry.error) {
      signedUrlByPath.set(entry.path, entry.signedUrl);
    }
  }

  // Step 4: Map back to original order, count failures
  let failedCount = 0;
  const signedUrls: string[] = [];

  for (const entry of orderedPaths) {
    if (!entry) {
      failedCount++;
      continue;
    }
    const signedUrl = signedUrlByPath.get(entry.path);
    if (signedUrl) {
      signedUrls.push(signedUrl);
    } else {
      failedCount++;
    }
  }

  return { signedUrls, failedCount };
}

/**
 * Strip bucket prefix if present. Supabase createSignedUrls expects
 * paths relative to the bucket root, not prefixed with the bucket name.
 */
function normaliseStoragePath(path: string): string {
  const prefix = `${MEDIA_BUCKET}/`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length);
  }
  return path;
}
