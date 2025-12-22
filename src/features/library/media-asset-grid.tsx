import { MediaAssetGridClient } from "@/features/library/media-asset-grid-client";
import { listMediaAssets } from "@/lib/library/data";

export async function MediaAssetGrid() {
  const assets = await listMediaAssets();

  return <MediaAssetGridClient assets={assets} />;
}
