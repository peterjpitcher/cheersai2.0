import { DateTime } from "luxon";

import type { ReadonlyURLSearchParams } from "next/navigation";

import { CreatePageClient } from "@/features/create/create-page-client";
import { listMediaAssets } from "@/lib/library/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { PageHeader } from "@/components/layout/PageHeader";

type SearchParamsLike = ReadonlyURLSearchParams | Record<string, string | string[] | undefined>;

interface CreatePageProps {
  searchParams?: Promise<SearchParamsLike>;
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
  const tabParam = resolveQueryParam(resolvedParams, "tab");

  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Create"
        description="Launch instant posts, story drops, event and promo campaigns, or recurring weekly content."
      />

      <div className="rounded-xl border border-white/20 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm shadow-sm p-4 md:p-6">
        <CreatePageClient
          mediaAssets={mediaAssets}
          plannerItems={plannerOverview.items}
          ownerTimezone={timezone}
          initialTab={tabParam}
        />
      </div>
    </div>
  );
}

function resolveQueryParam(params: SearchParamsLike | undefined, key: string) {
  if (!params) {
    return undefined;
  }

  if (isUrlSearchParams(params)) {
    const value = params.get(key);
    return value?.trim() ? value.trim() : undefined;
  }

  const raw = params[key];
  if (Array.isArray(raw)) {
    const first = raw.find((entry) => typeof entry === "string" && entry.trim().length);
    return first ? first.trim() : undefined;
  }

  if (typeof raw === "string" && raw.trim().length) {
    return raw.trim();
  }

  return undefined;
}

function isUrlSearchParams(value: SearchParamsLike): value is ReadonlyURLSearchParams {
  return typeof (value as ReadonlyURLSearchParams).get === "function";
}
