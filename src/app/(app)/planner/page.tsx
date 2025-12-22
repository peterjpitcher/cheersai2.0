import { Suspense } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { CreatePostButton } from "@/features/planner/create-post-button";

import { PlannerCalendar } from "@/features/planner/planner-calendar";
import { PlannerSkeleton } from "@/features/planner/planner-skeleton";
import { STATUS_QUERY_ALIASES, type PlannerStatusFilterValue } from "@/features/planner/status-filter-options";
import { PageHeader } from "@/components/layout/PageHeader";


type SearchParamsLike = ReadonlyURLSearchParams | Record<string, string | string[] | undefined>;

interface PlannerPageProps {
  searchParams?: Promise<SearchParamsLike>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const monthValue = resolveQueryParam(resolvedParams, "month");

  const statusFiltersSet = new Set<PlannerStatusFilterValue>();
  const collectStatusValues = (value: string | undefined) => {
    if (!value) return;
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .some((entry) => {
        const mapped = STATUS_QUERY_ALIASES[entry];
        if (mapped) {
          statusFiltersSet.add(mapped);
          return true;
        }
        return false;
      });
  };

  const rawStatusValues = resolveQueryParams(resolvedParams, "status");
  rawStatusValues.some((entry) => {
    collectStatusValues(entry);
    return statusFiltersSet.size > 0;
  });

  const statusFilters = Array.from(statusFiltersSet);

  const showImages = resolveQueryParam(resolvedParams, "show_images") !== "false";

  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Planner"
        description="Review and track your scheduled content across all channels."
        action={<CreatePostButton />}
      />

      <div className="flex-1 rounded-xl border border-white/20 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm shadow-sm p-1 md:p-6 overflow-hidden">
        <Suspense fallback={<PlannerSkeleton />}>
          <PlannerCalendar
            month={monthValue}
            statusFilters={statusFilters}
            showImages={showImages}
          />
        </Suspense>
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

function resolveQueryParams(params: SearchParamsLike | undefined, key: string) {
  if (!params) {
    return [];
  }

  if (isUrlSearchParams(params)) {
    return params
      .getAll(key)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const raw = params[key];
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof raw === "string" && raw.trim().length) {
    return [raw.trim()];
  }

  return [];
}

function isUrlSearchParams(value: SearchParamsLike): value is ReadonlyURLSearchParams {
  return typeof (value as ReadonlyURLSearchParams).get === "function";
}
