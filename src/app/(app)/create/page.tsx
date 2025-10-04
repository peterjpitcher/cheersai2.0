import { CreatePageClient } from "@/features/create/create-page-client";
import { listMediaAssets } from "@/lib/library/data";

export default async function CreatePage() {
  const mediaAssets = await listMediaAssets();

  return <CreatePageClient mediaAssets={mediaAssets} />;
}
