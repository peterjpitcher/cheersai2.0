import { describe, expect, it } from "vitest";

import { groupMediaAssetsByTag, UNTITLED_MEDIA_TAG } from "@/features/library/media-groups";
import type { MediaAssetSummary } from "@/lib/library/data";

function asset(id: string, tags: string[]): MediaAssetSummary {
  return {
    id,
    fileName: `${id}.png`,
    mediaType: "image",
    tags,
    uploadedAt: "2026-05-22T09:00:00.000Z",
    storagePath: `uploads/${id}.png`,
    processedStatus: "ready",
    derivedVariants: {},
    aspectClass: "square",
    previewShape: "square",
  };
}

describe("groupMediaAssetsByTag", () => {
  it("groups assets by every tag and leaves untagged assets last", () => {
    const groups = groupMediaAssetsByTag([
      asset("one", ["music", "event"]),
      asset("two", []),
      asset("three", ["food"]),
    ]);

    expect(groups.map((group) => group.tag)).toEqual(["event", "food", "music", UNTITLED_MEDIA_TAG]);
    expect(groups.find((group) => group.tag === "music")?.items.map((item) => item.id)).toEqual(["one"]);
    expect(groups.find((group) => group.tag === UNTITLED_MEDIA_TAG)?.items.map((item) => item.id)).toEqual(["two"]);
  });
});
