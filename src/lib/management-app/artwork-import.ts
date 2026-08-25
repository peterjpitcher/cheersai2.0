/**
 * Copying an event's designed artwork out of the management app and into the
 * CheersAI media library.
 *
 * Why copy rather than reference: the publish worker signs storage paths against
 * CheersAI's own bucket, so a remote URL in `storage_path` could never be
 * signed and the post would fail at publish time.
 *
 * Why one asset rather than two: the square becomes `storage_path` and the
 * designed 9:16 becomes `derived_variants.story`, which is exactly the shape the
 * worker already expects. Feed posts publish the square, stories publish the
 * designed portrait, and neither the worker nor the wizard's story gate needs to
 * know an import happened.
 *
 * The order of operations matters more than it looks. Storage and Postgres
 * cannot share a transaction, so the source key is claimed first, before any
 * download: without that, two imports of the same artwork would each download,
 * render and upload four objects, then collide on the unique index at the very
 * end with eight objects already written.
 */

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MEDIA_BUCKET } from "@/lib/constants";
import { normaliseTags } from "@/lib/library/tags";
import { loadMediaAssetSummary } from "@/lib/library/summary";
import type { MediaAssetSummary } from "@/lib/library/data";
import {
  getManagementEventArtwork,
  type ManagementApiConfig,
  type ManagementArtworkFile,
  type ManagementArtworkVariantKey,
} from "@/lib/management-app/client";
import { ArtworkFetchError, fetchArtworkFile } from "@/lib/management-app/artwork-fetch";
import {
  ARTWORK_TRANSFORM_VERSION,
  buildArtworkSourceKey,
} from "@/lib/management-app/artwork-provenance";
import {
  ArtworkImageError,
  RENDITION_SIZES,
  renderArtworkRendition,
  validateArtworkSource,
  type ArtworkRendition,
  type ValidatedArtworkSource,
} from "@/lib/management-app/artwork-image";

/** A management-app upload session replaces variants one at a time. */
const MIXED_KIT_TOLERANCE_MS = 10 * 60 * 1000;

const RESERVE_STALE_AFTER = "10 minutes";

type VariantKey = ManagementArtworkVariantKey;

const VARIANT_KEYS: VariantKey[] = ["square", "story", "landscape"];

/**
 * Which source each rendition prefers, best first.
 *
 * Every rendition can be produced from any source, so a partial kit still yields
 * an asset that publishes to both feed and story. It just says so in the warning.
 */
const RENDITION_SOURCES: Record<ArtworkRendition, VariantKey[]> = {
  feed: ["square", "landscape", "story"],
  story: ["story", "square", "landscape"],
  square: ["square", "landscape", "story"],
  landscape: ["landscape", "square", "story"],
};

export type ArtworkImportStatus =
  | "imported"
  | "reused"
  | "partial"
  | "in_progress"
  | "none"
  | "unavailable"
  | "failed";

export interface ArtworkImportOutcome {
  status: ArtworkImportStatus;
  assetId?: string;
  asset?: MediaAssetSummary;
  warning?: string;
  /** Stable, greppable failure label for logs. Never shown to a user. */
  errorClass?: string;
  stageMs: Record<string, number>;
  sourceCounts: { offered: number; fetched: number; failed: number };
  bytesIn: number;
  bytesOut: number;
}

export interface ImportEventArtworkInput {
  supabase: SupabaseClient;
  config: ManagementApiConfig;
  accountId: string;
  eventId: string;
  eventName: string;
  /** Wall-clock cutoff. Past it the import gives up rather than being killed mid-write. */
  deadlineAt: number;
}

export async function importEventArtwork(
  input: ImportEventArtworkInput,
): Promise<ArtworkImportOutcome> {
  const { supabase, config, accountId, eventId, eventName, deadlineAt } = input;

  const stageMs: Record<string, number> = {};
  const counts = { offered: 0, fetched: 0, failed: 0 };
  let bytesIn = 0;
  let bytesOut = 0;

  const fail = (
    status: ArtworkImportStatus,
    errorClass: string,
    warning: string,
  ): ArtworkImportOutcome => ({
    status,
    errorClass,
    warning,
    stageMs,
    sourceCounts: counts,
    bytesIn,
    bytesOut,
  });

  // --- Resolve -------------------------------------------------------------
  const resolveStart = Date.now();
  const artwork = await getManagementEventArtwork(config, eventId);
  stageMs.resolve = Date.now() - resolveStart;

  if (artwork.status === "unavailable") {
    return fail(
      "unavailable",
      artwork.reason === "forbidden" ? "unavailable_forbidden" : "unavailable_route",
      "Artwork import is not available for this management app connection.",
    );
  }

  if (artwork.status === "error") {
    return fail("failed", "resolve_failed", "Event artwork could not be read from the management app.");
  }

  const offered = VARIANT_KEYS.filter((key) => artwork.variants[key]?.url);
  counts.offered = offered.length;

  if (offered.length === 0) {
    return {
      status: "none",
      warning: "This event has no artwork in the management app.",
      stageMs,
      sourceCounts: counts,
      bytesIn,
      bytesOut,
    };
  }

  // --- Reuse ---------------------------------------------------------------
  const sourceKey = buildSourceKey(eventId, artwork.variants);

  const existing = await findReusableAsset(supabase, accountId, sourceKey);
  if (existing) {
    return {
      status: "reused",
      assetId: existing.id,
      asset: existing,
      stageMs,
      sourceCounts: counts,
      bytesIn,
      bytesOut,
    };
  }

  // --- Reserve -------------------------------------------------------------
  const assetId = randomUUID();
  const slug = slugifyEventName(eventName);
  const fileName = `${slug}-artwork.jpg`;
  const storagePath = `${accountId}/${assetId}/${slug}.jpg`;
  const derivedPaths: Record<Exclude<ArtworkRendition, "feed">, string> = {
    square: `derived/${assetId}/square.jpg`,
    story: `derived/${assetId}/story.jpg`,
    landscape: `derived/${assetId}/landscape.jpg`,
  };
  const tags = normaliseTags([slug, "event-artwork"]);

  const reserveStart = Date.now();
  const { data: reserveRows, error: reserveError } = await supabase.rpc(
    "reserve_imported_media_asset",
    {
      p_account_id: accountId,
      p_source_key: sourceKey,
      p_asset_id: assetId,
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_tags: tags,
      p_stale_after: RESERVE_STALE_AFTER,
    },
  );
  stageMs.reserve = Date.now() - reserveStart;

  if (reserveError) {
    console.error("[artwork-import] reserve failed", { eventId, error: reserveError.message });
    return fail("failed", "db_failed", "Event artwork could not be imported. Add media in the next step.");
  }

  const reservation = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
  const outcome = (reservation as { outcome?: string } | null)?.outcome;
  const reservedId = (reservation as { asset_id?: string } | null)?.asset_id ?? assetId;

  if (outcome === "reused") {
    const asset = await loadMediaAssetSummary(supabase, accountId, reservedId);
    return {
      status: "reused",
      assetId: reservedId,
      asset: asset ?? undefined,
      stageMs,
      sourceCounts: counts,
      bytesIn,
      bytesOut,
    };
  }

  if (outcome === "in_progress") {
    return {
      status: "in_progress",
      assetId: reservedId,
      stageMs,
      sourceCounts: counts,
      bytesIn,
      bytesOut,
    };
  }

  // Everything past this point owns the reservation, so every failure must clean
  // up after itself. `uploaded` is the compensation list.
  const uploaded: string[] = [];

  const abandon = async (errorClass: string, warning: string): Promise<ArtworkImportOutcome> => {
    await cleanUpFailedImport(supabase, accountId, assetId, uploaded);
    return fail("failed", errorClass, warning);
  };

  try {
    // --- Fetch and validate ------------------------------------------------
    const fetchStart = Date.now();
    const sources = new Map<VariantKey, ValidatedArtworkSource>();
    const lost: Array<{ key: VariantKey; reason: string }> = [];

    const fetched = await Promise.all(
      offered.map(async (key) => {
        const file = artwork.variants[key] as ManagementArtworkFile;
        try {
          const downloaded = await fetchArtworkFile(file.url);
          const validated = await validateArtworkSource(downloaded.bytes);
          return { key, validated, bytes: downloaded.bytes.byteLength };
        } catch (error) {
          return { key, reason: classifySourceError(error) };
        }
      }),
    );
    stageMs.fetch = Date.now() - fetchStart;

    for (const entry of fetched) {
      if ("validated" in entry && entry.validated) {
        sources.set(entry.key, entry.validated);
        bytesIn += entry.bytes ?? 0;
        counts.fetched += 1;
      } else if ("reason" in entry) {
        lost.push({ key: entry.key, reason: entry.reason });
        counts.failed += 1;
      }
    }

    if (sources.size === 0) {
      return abandon(
        "fetch_failed",
        "Event artwork could not be imported. Add media in the next step.",
      );
    }

    if (Date.now() > deadlineAt) {
      return abandon("deadline_exceeded", "Event artwork import took too long. Add media in the next step.");
    }

    // --- Render ------------------------------------------------------------
    const renderStart = Date.now();
    const chosen: Partial<Record<ArtworkRendition, VariantKey>> = {};
    const rendered: Partial<Record<ArtworkRendition, Buffer>> = {};

    for (const rendition of ["feed", "story", "square", "landscape"] as ArtworkRendition[]) {
      const sourceKeyForRendition = RENDITION_SOURCES[rendition].find((key) => sources.has(key));
      if (!sourceKeyForRendition) {
        return abandon("transform_failed", "Event artwork could not be prepared. Add media in the next step.");
      }

      chosen[rendition] = sourceKeyForRendition;
      try {
        rendered[rendition] = await renderArtworkRendition(
          sources.get(sourceKeyForRendition) as ValidatedArtworkSource,
          rendition,
        );
      } catch (error) {
        console.error("[artwork-import] render failed", { eventId, rendition, error });
        return abandon("transform_failed", "Event artwork could not be prepared. Add media in the next step.");
      }
    }
    stageMs.transform = Date.now() - renderStart;

    if (Date.now() > deadlineAt) {
      return abandon("deadline_exceeded", "Event artwork import took too long. Add media in the next step.");
    }

    // --- Upload ------------------------------------------------------------
    const uploadStart = Date.now();
    const uploads: Array<[string, Buffer]> = [
      [storagePath, rendered.feed as Buffer],
      [derivedPaths.story, rendered.story as Buffer],
      [derivedPaths.square, rendered.square as Buffer],
      [derivedPaths.landscape, rendered.landscape as Buffer],
    ];

    for (const [path, body] of uploads) {
      const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });

      if (error) {
        console.error("[artwork-import] upload failed", { eventId, path, error: error.message });
        return abandon("upload_failed", "Event artwork could not be saved. Add media in the next step.");
      }

      uploaded.push(path);
      bytesOut += body.byteLength;
    }
    stageMs.upload = Date.now() - uploadStart;

    // --- Finalise ----------------------------------------------------------
    const dbStart = Date.now();
    const { error: finaliseError } = await supabase.rpc("finalise_imported_media_asset", {
      p_account_id: accountId,
      p_asset_id: assetId,
      p_size_bytes: (rendered.feed as Buffer).byteLength,
      p_derived_variants: {
        original: storagePath,
        square: derivedPaths.square,
        story: derivedPaths.story,
        landscape: derivedPaths.landscape,
      },
      p_width: RENDITION_SIZES.feed.width,
      p_height: RENDITION_SIZES.feed.height,
      p_source_metadata: {
        provider: "ams",
        entityType: "event",
        eventId,
        transformVersion: ARTWORK_TRANSFORM_VERSION,
        kitUpdatedAt: artwork.kitUpdatedAt,
        variants: Object.fromEntries(
          VARIANT_KEYS.map((key) => [
            key,
            artwork.variants[key]
              ? { url: artwork.variants[key]?.url, updatedAt: artwork.variants[key]?.updatedAt }
              : null,
          ]),
        ),
        renditionSources: chosen,
      },
    });
    stageMs.db = Date.now() - dbStart;

    if (finaliseError) {
      console.error("[artwork-import] finalise failed", { eventId, error: finaliseError.message });
      return abandon("db_failed", "Event artwork could not be saved. Add media in the next step.");
    }

    const asset = await loadMediaAssetSummary(supabase, accountId, assetId);

    const warning = buildWarning({
      chosen,
      sources,
      lost,
      variants: artwork.variants,
    });

    return {
      status: lost.length > 0 ? "partial" : "imported",
      assetId,
      asset: asset ?? undefined,
      warning,
      stageMs,
      sourceCounts: counts,
      bytesIn,
      bytesOut,
    };
  } catch (error) {
    console.error("[artwork-import] unexpected failure", { eventId, error });
    return abandon("unexpected", "Event artwork could not be imported. Add media in the next step.");
  }
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Adapter over the shared key builder for the client's variant shape. */
export function buildSourceKey(
  eventId: string,
  variants: Record<VariantKey, ManagementArtworkFile | null>,
): string {
  return buildArtworkSourceKey(eventId, {
    square: variants.square ? { url: variants.square.url, updatedAt: variants.square.updatedAt } : null,
    story: variants.story ? { url: variants.story.url, updatedAt: variants.story.updatedAt } : null,
    landscape: variants.landscape
      ? { url: variants.landscape.url, updatedAt: variants.landscape.updatedAt }
      : null,
  });
}

/**
 * Find a previously imported asset that is genuinely still usable.
 *
 * Provenance proves where a row came from, not that it still works. The row may
 * have been hidden, replaced, or left half-written by a run that died, and its
 * storage objects may be gone. Reusing any of those hands the user an asset that
 * looks selected and then fails at publish, so anything that does not pass every
 * check gives up its source key and lets a fresh import take over. The old row
 * itself is left alone: scheduled posts may still reference it.
 */
async function findReusableAsset(
  supabase: SupabaseClient,
  accountId: string,
  sourceKey: string,
): Promise<MediaAssetSummary | null> {
  const { data } = await supabase
    .from("media_assets")
    .select("id, processed_status, hidden_at, storage_path, derived_variants")
    .eq("account_id", accountId)
    .eq("source_key", sourceKey)
    .maybeSingle();

  if (!data) return null;

  const row = data as {
    id: string;
    processed_status: string | null;
    hidden_at: string | null;
    storage_path: string;
    derived_variants: Record<string, string> | null;
  };

  const derived = row.derived_variants ?? {};
  const paths = [row.storage_path, derived.story, derived.square, derived.landscape].filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  );

  const structurallyOk =
    row.processed_status === "ready" &&
    row.hidden_at === null &&
    typeof derived.story === "string" &&
    derived.story.length > 0 &&
    paths.length === 4;

  const objectsOk = structurallyOk ? await allPathsSignable(supabase, paths) : false;

  if (structurallyOk && objectsOk) {
    return loadMediaAssetSummary(supabase, accountId, row.id);
  }

  // Free the key for a clean re-import without disturbing the asset itself.
  const { error } = await supabase
    .from("media_assets")
    .update({ source_key: null })
    .eq("id", row.id)
    .eq("account_id", accountId);

  if (error) {
    console.error("[artwork-import] failed to release a stale source key", {
      assetId: row.id,
      error: error.message,
    });
  }

  return null;
}

async function allPathsSignable(supabase: SupabaseClient, paths: string[]): Promise<boolean> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(paths, 60);
  if (error || !data) return false;
  return data.length === paths.length && data.every((entry) => Boolean(entry?.signedUrl) && !entry?.error);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Undo a failed attempt.
 *
 * Objects go first: releasing the database row while its files remain would
 * leave storage litter that nothing points at and nothing can find. A cleanup
 * failure is logged loudly with the exact paths rather than swallowed, because
 * it is the one state this design cannot repair by itself.
 */
async function cleanUpFailedImport(
  supabase: SupabaseClient,
  accountId: string,
  assetId: string,
  uploadedPaths: string[],
): Promise<void> {
  if (uploadedPaths.length > 0) {
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(uploadedPaths);
    if (error) {
      console.error("[artwork-import] cleanup_failed: orphaned storage objects", {
        assetId,
        paths: uploadedPaths,
        error: error.message,
      });
    }
  }

  const { error: releaseError } = await supabase.rpc("release_imported_media_asset", {
    p_account_id: accountId,
    p_asset_id: assetId,
  });

  if (releaseError) {
    console.error("[artwork-import] cleanup_failed: reservation not released", {
      assetId,
      error: releaseError.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

const VARIANT_LABEL: Record<VariantKey, string> = {
  square: "square",
  story: "story",
  landscape: "landscape",
};

export function buildWarning(args: {
  chosen: Partial<Record<ArtworkRendition, VariantKey>>;
  sources: Map<VariantKey, unknown>;
  lost: Array<{ key: VariantKey; reason: string }>;
  variants: Record<VariantKey, ManagementArtworkFile | null>;
}): string | undefined {
  const parts: string[] = [];
  const { chosen, sources, lost, variants } = args;

  const storySource = chosen.story;
  const feedSource = chosen.feed;

  if (storySource && storySource !== "story") {
    const storyWasOffered = Boolean(variants.story?.url);
    parts.push(
      storyWasOffered
        ? `The story artwork could not be read, so the story crop was generated from the ${VARIANT_LABEL[storySource]}.`
        : `No designed story artwork in the management app, so the story crop was generated from the ${VARIANT_LABEL[storySource]}.`,
    );
  }

  if (feedSource && feedSource !== "square") {
    const squareWasOffered = Boolean(variants.square?.url);
    parts.push(
      squareWasOffered
        ? `The square artwork could not be read, so the feed image was cropped from the ${VARIANT_LABEL[feedSource]}.`
        : `No square artwork, so the feed image was cropped from the ${VARIANT_LABEL[feedSource]}.`,
    );
  }

  if (variants.square?.inherited && sources.has("square")) {
    parts.push("The square is the event category's default image, not artwork designed for this event.");
  }

  const lostWithoutMention = lost.filter((entry) => entry.key !== "story" && entry.key !== "square");
  if (lostWithoutMention.length > 0) {
    parts.push(
      `Could not read the ${lostWithoutMention.map((entry) => VARIANT_LABEL[entry.key]).join(" and ")} artwork.`,
    );
  }

  if (isMixedKit(variants)) {
    parts.push("The management app artwork may have been part-updated; check the preview.");
  }

  return parts.length ? parts.join(" ") : undefined;
}

/**
 * Variants are uploaded one at a time, so a kit replaced mid-session can be read
 * as a mixture of old and new. It cannot be prevented from this side, but a
 * spread in the revision timestamps makes it visible.
 */
export function isMixedKit(variants: Record<VariantKey, ManagementArtworkFile | null>): boolean {
  const times = VARIANT_KEYS.map((key) => variants[key]?.updatedAt)
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (times.length < 2) return false;

  return Math.max(...times) - Math.min(...times) > MIXED_KIT_TOLERANCE_MS;
}

function classifySourceError(error: unknown): string {
  if (error instanceof ArtworkFetchError) return `fetch_${error.kind}`;
  if (error instanceof ArtworkImageError) return `image_${error.kind}`;
  return "unknown";
}

/** Recognisable in the library without being a storage key. */
export function slugifyEventName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");

  return slug || "event";
}
