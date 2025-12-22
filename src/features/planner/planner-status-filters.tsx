"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  STATUS_FILTER_OPTIONS,
  type PlannerStatusFilterValue,
} from "@/features/planner/status-filter-options";

interface PlannerStatusFiltersProps {
  selected: PlannerStatusFilterValue[];
}

export function PlannerStatusFilters({ selected }: PlannerStatusFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggleStatus = useCallback(
    (value: PlannerStatusFilterValue) => {
      const params = new URLSearchParams(searchParams.toString());
      const current = (params.get("status") ?? "").trim();
      const isActive = current === value;

      if (isActive) {
        params.delete("status");
      } else {
        params.set("status", value);
      }

      router.push(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    router.push(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-primary/70">Filter status:</span>
      {STATUS_FILTER_OPTIONS.map((option) => {
        const isActive = selected.includes(option.value);
        const classes = [
          "rounded-full border px-3 py-1 text-xs font-semibold transition",
          isActive
            ? "border-primary bg-primary text-white shadow"
            : "border-primary/20 bg-white text-primary hover:border-primary hover:bg-blue-50",
        ].join(" ");

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggleStatus(option.value)}
            className={classes}
            aria-pressed={isActive}
          >
            {option.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={clearFilters}
        className="rounded-full border border-transparent bg-transparent px-3 py-1 text-xs font-semibold text-primary/70 underline-offset-2 transition hover:text-primary hover:underline"
      >
        Clear
      </button>
    </div>
  );
}
