"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface CampaignFiltersProps {
  currentFilter: string;
  counts: {
    all: number;
    active: number;
    draft: number;
    completed: number;
  };
}

export default function CampaignFilters({ currentFilter, counts }: CampaignFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleFilterChange = useCallback((status: string) => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (status === "all") {
      params.delete("status");
    } else {
      params.set("status", status);
    }
    
    const queryString = params.toString();
    const url = queryString ? `/campaigns?${queryString}` : "/campaigns";
    
    router.push(url);
  }, [router, searchParams]);

  const filters = [
    { key: "all", label: "All", count: counts.all },
    { key: "active", label: "Active", count: counts.active },
    { key: "draft", label: "Draft", count: counts.draft },
    { key: "completed", label: "Completed", count: counts.completed },
  ];

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {filters.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => handleFilterChange(key)}
            className={`
              flex items-center gap-2 rounded-medium px-4 py-2
              text-sm font-medium transition-all
              ${
                currentFilter === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border bg-surface text-text-secondary hover:bg-muted hover:text-foreground"
              }
            `}
          >
            {label}
            <span
              className={`
                rounded-full px-2 py-1 text-xs font-medium
                ${
                  currentFilter === key
                    ? "bg-white/20 text-white"
                    : "bg-text-secondary/10 text-text-secondary"
                }
              `}
            >
              {count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
