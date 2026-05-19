import { MediaAssetGridClient } from "@/features/library/media-asset-grid-client";
import { listMediaAssets } from "@/lib/library/data";

export async function MediaAssetGrid() {
  const assets = await listMediaAssets({
    excludeTags: ["Tournament"],
    excludeStoragePathPrefixes: ["tournaments/"],
  });

  // Collect unique tags for the filter pills
  const tagSet = new Set<string>();
  for (const asset of assets) {
    for (const tag of asset.tags) {
      const trimmed = tag.trim();
      if (trimmed.length) tagSet.add(trimmed);
    }
  }
  const availableTags = Array.from(tagSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  return (
    <MediaAssetGridClient
      assets={assets}
      availableTags={availableTags}
    />
  );
}
