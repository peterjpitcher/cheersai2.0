import { CreatePageClient } from "@/features/create/create-page-client";
import { listMediaAssets } from "@/lib/library/data";

interface CreatePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CreatePage({ searchParams }: CreatePageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const mediaAssets = await listMediaAssets();
  const tabValue = resolvedParams?.tab;
  const tabParam = typeof tabValue === "string" ? tabValue : Array.isArray(tabValue) ? tabValue[0] : undefined;

  return <CreatePageClient mediaAssets={mediaAssets} initialTab={tabParam} />;
}
