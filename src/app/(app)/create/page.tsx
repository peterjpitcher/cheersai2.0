import { DateTime } from "luxon";

import type { ReadonlyURLSearchParams } from "next/navigation";

import { CreatePageClient } from "@/features/create/create-page-client";
import { listMediaAssets } from "@/lib/library/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

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
    <CreatePageClient
      mediaAssets={mediaAssets}
      plannerItems={plannerOverview.items}
      ownerTimezone={timezone}
      initialTab={tabParam}
    />
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
