/**
 * The pure decisions behind auto-attaching imported event artwork.
 *
 * Kept out of the wizard component so the awkward parts can be tested directly.
 * Both of them are ordering bugs waiting to happen:
 *
 *  - the media library loads asynchronously on mount and used to overwrite the
 *    whole list when it resolved, so an import that finished first vanished;
 *  - an import takes seconds, during which the user can pick a different event,
 *    change their mind, or attach their own media.
 */

import type { MediaAssetSummary } from "@/lib/library/data";

/**
 * Merge library lists by id, newest first, without losing either side.
 *
 * `incoming` wins on conflict: a freshly signed summary carries live preview
 * URLs, where the older copy's may already have expired.
 */
export function mergeLibraryItems(
  existing: MediaAssetSummary[],
  incoming: MediaAssetSummary[],
): MediaAssetSummary[] {
  if (incoming.length === 0) return existing;

  const byId = new Map<string, MediaAssetSummary>();
  for (const item of incoming) byId.set(item.id, item);

  const merged: MediaAssetSummary[] = [];
  const seen = new Set<string>();

  // Anything only in `incoming` is newer than the loaded page, so it leads.
  for (const item of incoming) {
    if (existing.some((current) => current.id === item.id)) continue;
    merged.push(item);
    seen.add(item.id);
  }

  for (const item of existing) {
    if (seen.has(item.id)) continue;
    merged.push(byId.get(item.id) ?? item);
    seen.add(item.id);
  }

  return merged;
}

export interface ArtworkAttribution {
  eventId: string;
  assetId: string;
}

export interface ArtworkSelectionDecision {
  /** What the wizard's selection should become. Unchanged means do nothing. */
  selection: string[];
  attribution: ArtworkAttribution | null;
  /**
   * True when the user's own media was left alone and they should be offered an
   * explicit swap instead.
   */
  offerReplace: boolean;
}

/**
 * Decide what a finished import should do to the current media selection.
 *
 * The rule is narrow on purpose: artwork may take over a selection it put there
 * itself, and nothing else. Anything the user chose, or artwork they have since
 * edited, is left exactly as it is and offered as a button. Silently swapping a
 * user's chosen image for one an import fetched is the kind of change nobody
 * notices until it has published.
 */
export function decideArtworkSelection(args: {
  currentSelection: string[];
  attribution: ArtworkAttribution | null;
  assetId: string;
  eventId: string;
}): ArtworkSelectionDecision {
  const { currentSelection, attribution, assetId, eventId } = args;

  if (currentSelection.length === 0) {
    return { selection: [assetId], attribution: { eventId, assetId }, offerReplace: false };
  }

  if (currentSelection.length === 1 && currentSelection[0] === assetId) {
    // Already exactly this artwork, e.g. a repeat import of the same event.
    return { selection: currentSelection, attribution: { eventId, assetId }, offerReplace: false };
  }

  const isUntouchedAutoSelection =
    attribution !== null &&
    currentSelection.length === 1 &&
    currentSelection[0] === attribution.assetId;

  if (isUntouchedAutoSelection) {
    return { selection: [assetId], attribution: { eventId, assetId }, offerReplace: false };
  }

  return { selection: currentSelection, attribution, offerReplace: true };
}

export interface ArtworkRequest {
  token: number;
  eventId: string;
}

/**
 * Should a completed import be applied at all?
 *
 * An import is slow and runs alongside a form the user keeps using, so results
 * arrive out of order. Applying a stale one attaches the previous event's
 * artwork to the current post, which then publishes.
 */
export function isCurrentArtworkResult(
  pending: ArtworkRequest | null,
  result: ArtworkRequest,
): boolean {
  if (!pending) return false;
  return pending.token === result.token && pending.eventId === result.eventId;
}
