import type { ReadonlyURLSearchParams } from "next/navigation";

import { PlannerCalendar } from "@/features/planner/planner-calendar";
import { STATUS_QUERY_ALIASES, type PlannerStatusFilterValue } from "@/features/planner/status-filter-options";

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

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <h2 className="text-2xl font-semibold">Planner</h2>
        <p className="mt-2 text-sm text-white/80">Review and adjust your scheduled content at a glance.</p>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/90 p-4 text-brand-teal shadow-lg">
        <PlannerCalendar
          month={monthValue}
          statusFilters={statusFilters}
        />
      </section>
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
