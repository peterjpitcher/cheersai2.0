/**
 * Provenance for media copied in from the management app.
 *
 * Kept in its own module, free of Sharp and the Supabase client, so that code
 * which only needs to ask "did this asset come from an event?" (the scheduling
 * path, for one) does not pull the whole image pipeline into its bundle.
 */

import { createHash } from "node:crypto";

/**
 * Bump when the crop, quality or colour handling changes.
 *
 * It is part of the source key, so an asset rendered by an older version is not
 * silently reused once the renderer has moved on.
 */
export const ARTWORK_TRANSFORM_VERSION = 1;

export const ARTWORK_SOURCE_PREFIX = "ams:event:";

export interface ArtworkSourceRevision {
  url: string;
  updatedAt: string | null;
}

/**
 * A key that changes whenever the rendered output would change.
 *
 * Every source URL and its revision goes in, with explicit nulls so "landscape
 * removed" is a different input from "landscape unchanged". The transform
 * version goes in too, so a change to the crop or quality does not quietly reuse
 * an asset rendered by the old code.
 */
export function buildArtworkSourceKey(
  eventId: string,
  variants: {
    square: ArtworkSourceRevision | null;
    story: ArtworkSourceRevision | null;
    landscape: ArtworkSourceRevision | null;
  },
): string {
  const canonical = JSON.stringify({
    v: ARTWORK_TRANSFORM_VERSION,
    eventId,
    square: variants.square?.url ?? null,
    story: variants.story?.url ?? null,
    landscape: variants.landscape?.url ?? null,
    updatedAt: {
      square: variants.square?.updatedAt ?? null,
      story: variants.story?.updatedAt ?? null,
      landscape: variants.landscape?.updatedAt ?? null,
    },
  });

  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `${ARTWORK_SOURCE_PREFIX}${eventId}:${hash}`;
}

/** True for an asset this pipeline created, whatever event it came from. */
export function isImportedEventArtwork(sourceKey: string | null | undefined): boolean {
  return typeof sourceKey === "string" && sourceKey.startsWith(ARTWORK_SOURCE_PREFIX);
}
