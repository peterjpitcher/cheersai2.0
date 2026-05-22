import type { MediaAssetSummary } from "@/lib/library/data";

export const UNTITLED_MEDIA_TAG = "Untagged";

export type MediaAssetGroup = {
  tag: string;
  items: MediaAssetSummary[];
  isUntagged: boolean;
};

export function groupMediaAssetsByTag(assets: MediaAssetSummary[]): MediaAssetGroup[] {
  const tagGroups = new Map<string, MediaAssetGroup>();

  for (const asset of assets) {
    const tags = asset.tags.length ? asset.tags : [UNTITLED_MEDIA_TAG];
    for (const rawTag of tags) {
      const tag = rawTag.trim().length ? rawTag.trim() : UNTITLED_MEDIA_TAG;
      const existing = tagGroups.get(tag);
      if (existing) {
        existing.items.push(asset);
      } else {
        tagGroups.set(tag, {
          tag,
          items: [asset],
          isUntagged: tag === UNTITLED_MEDIA_TAG,
        });
      }
    }
  }

  return Array.from(tagGroups.values()).sort((a, b) => {
    if (a.isUntagged) return 1;
    if (b.isUntagged) return -1;
    return a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" });
  });
}
