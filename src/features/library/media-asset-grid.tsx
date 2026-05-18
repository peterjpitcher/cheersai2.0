import { MediaAssetGridClient } from "@/features/library/media-asset-grid-client";
import { listMediaAssets } from "@/lib/library/data";

export async function MediaAssetGrid() {
  const assets = await listMediaAssets({
    excludeTags: ["Tournament"],
    excludeStoragePathPrefixes: ["tournaments/"],
  });

  return <MediaAssetGridClient assets={assets} />;
}
