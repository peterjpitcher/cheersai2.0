// The two ordering hazards in auto-attaching imported artwork, tested directly
// rather than through the wizard: the library loading after the import, and a
// slow import landing after the user has moved on.

import { describe, expect, it } from "vitest";

import {
  decideArtworkSelection,
  isCurrentArtworkResult,
  mergeLibraryItems,
} from "@/features/create/artwork-selection";
import type { MediaAssetSummary } from "@/lib/library/data";

function asset(id: string, extra: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    id,
    fileName: `${id}.jpg`,
    mediaType: "image",
    tags: [],
    uploadedAt: "2026-08-25T09:00:00.000Z",
    storagePath: `acct/${id}/a.jpg`,
    processedStatus: "ready",
    derivedVariants: { story: `derived/${id}/story.jpg` },
    aspectClass: "square",
    previewShape: "square",
    ...extra,
  };
}

describe("mergeLibraryItems", () => {
  it("keeps an imported asset when the library load resolves afterwards", () => {
    // The bug this exists for: the wizard replaced the whole list on load, so an
    // import that finished first vanished while its id stayed selected, leaving
    // later steps rendering a selection they could not find.
    const afterImport = [asset("imported")];
    const loaded = [asset("old-1"), asset("old-2")];

    const merged = mergeLibraryItems(afterImport, loaded);

    expect(merged.map((item) => item.id)).toEqual(["old-1", "old-2", "imported"]);
  });

  it("puts a newly imported asset at the front when it arrives second", () => {
    const merged = mergeLibraryItems([asset("old-1")], [asset("imported")]);
    expect(merged.map((item) => item.id)).toEqual(["imported", "old-1"]);
  });

  it("prefers the incoming copy, whose preview URLs are freshly signed", () => {
    const stale = asset("a", { previewUrl: "signed-yesterday" });
    const fresh = asset("a", { previewUrl: "signed-now" });

    expect(mergeLibraryItems([stale], [fresh])[0].previewUrl).toBe("signed-now");
  });

  it("never duplicates an id", () => {
    const merged = mergeLibraryItems([asset("a"), asset("b")], [asset("b"), asset("c")]);
    expect(merged.map((item) => item.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("is a no-op for an empty incoming list", () => {
    const existing = [asset("a")];
    expect(mergeLibraryItems(existing, [])).toBe(existing);
  });
});

describe("decideArtworkSelection", () => {
  it("attaches artwork when nothing is selected", () => {
    const decision = decideArtworkSelection({
      currentSelection: [],
      attribution: null,
      assetId: "art-1",
      eventId: "evt-1",
    });

    expect(decision).toEqual({
      selection: ["art-1"],
      attribution: { eventId: "evt-1", assetId: "art-1" },
      offerReplace: false,
    });
  });

  it("replaces its own untouched auto-selection when the user picks a different event", () => {
    const decision = decideArtworkSelection({
      currentSelection: ["art-1"],
      attribution: { eventId: "evt-1", assetId: "art-1" },
      assetId: "art-2",
      eventId: "evt-2",
    });

    expect(decision.selection).toEqual(["art-2"]);
    expect(decision.offerReplace).toBe(false);
  });

  it("leaves media the user chose alone and offers a swap instead", () => {
    // Quietly swapping a chosen image for one an import fetched is the kind of
    // change nobody notices until it has published.
    const decision = decideArtworkSelection({
      currentSelection: ["user-picked"],
      attribution: null,
      assetId: "art-1",
      eventId: "evt-1",
    });

    expect(decision.selection).toEqual(["user-picked"]);
    expect(decision.offerReplace).toBe(true);
    expect(decision.attribution).toBeNull();
  });

  it("leaves an auto-selection the user has since added to", () => {
    const decision = decideArtworkSelection({
      currentSelection: ["art-1", "user-added"],
      attribution: { eventId: "evt-1", assetId: "art-1" },
      assetId: "art-2",
      eventId: "evt-2",
    });

    expect(decision.selection).toEqual(["art-1", "user-added"]);
    expect(decision.offerReplace).toBe(true);
  });

  it("leaves an auto-selection the user has since swapped out", () => {
    const decision = decideArtworkSelection({
      currentSelection: ["something-else"],
      attribution: { eventId: "evt-1", assetId: "art-1" },
      assetId: "art-2",
      eventId: "evt-2",
    });

    expect(decision.offerReplace).toBe(true);
  });

  it("is idempotent when the same event is imported twice", () => {
    const decision = decideArtworkSelection({
      currentSelection: ["art-1"],
      attribution: null,
      assetId: "art-1",
      eventId: "evt-1",
    });

    expect(decision.selection).toEqual(["art-1"]);
    expect(decision.offerReplace).toBe(false);
  });
});

describe("isCurrentArtworkResult", () => {
  it("accepts the result the user is still waiting for", () => {
    expect(isCurrentArtworkResult({ token: 3, eventId: "evt-1" }, { token: 3, eventId: "evt-1" })).toBe(true);
  });

  it("discards a superseded request", () => {
    // Event A's artwork landing after the user switched to event B would attach
    // the wrong image to the post, and it would publish that way.
    expect(isCurrentArtworkResult({ token: 4, eventId: "evt-2" }, { token: 3, eventId: "evt-1" })).toBe(false);
  });

  it("discards a result whose event no longer matches, even on a matching token", () => {
    expect(isCurrentArtworkResult({ token: 3, eventId: "evt-2" }, { token: 3, eventId: "evt-1" })).toBe(false);
  });

  it("discards everything once nothing is pending", () => {
    expect(isCurrentArtworkResult(null, { token: 1, eventId: "evt-1" })).toBe(false);
  });
});
