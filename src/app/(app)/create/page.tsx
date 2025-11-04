import { DateTime } from "luxon";

import type { ReadonlyURLSearchParams } from "next/navigation";

import { CreatePageClient } from "@/features/create/create-page-client";
import { listMediaAssets } from "@/lib/library/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

interface CreatePageProps {
  searchParams?: Promise<ReadonlyURLSearchParams>;
}

export default async function CreatePage({ searchParams }: CreatePageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const mediaAssets = await listMediaAssets();
  const ownerSettings = await getOwnerSettings();
  const timezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;

  const now = DateTime.now().setZone(timezone);
  const rangeStart = now.startOf("month").toUTC().toJSDate();
  const rangeEnd = now.plus({ months: 2 }).endOf("month").toUTC().toJSDate();
  const plannerOverview = await getPlannerOverview({
    rangeStart,
    rangeEnd,
    includeActivity: false,
    includeTrash: false,
  });
  const tabParamRaw = resolvedParams?.get("tab") ?? undefined;
  const tabParam = tabParamRaw?.trim() ? tabParamRaw.trim() : undefined;

  return (
    <CreatePageClient
      mediaAssets={mediaAssets}
      plannerItems={plannerOverview.items}
      ownerTimezone={timezone}
      initialTab={tabParam}
    />
  );
}
