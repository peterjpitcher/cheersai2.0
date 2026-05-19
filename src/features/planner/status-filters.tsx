'use client';

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ContentStatus, Platform } from '@/types/content';
import { PLATFORMS } from '@/lib/constants';

/** Status filter options shown in the filter bar */
const STATUS_OPTIONS: Array<{ value: ContentStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
];

/** Platform filter options with display labels */
const PLATFORM_OPTIONS: Array<{ value: Platform; label: string }> = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'gbp', label: 'Google' },
];

interface StatusFiltersProps {
  onStatusChange?: (statuses: ContentStatus[]) => void;
  onPlatformChange?: (platforms: Platform[]) => void;
  initialStatuses?: ContentStatus[];
  initialPlatforms?: Platform[];
}

/**
 * Horizontal filter bar for the planner calendar.
 * Provides status toggles (Draft, Scheduled, Published, Failed)
 * and platform toggles (Facebook, Instagram, GBP).
 */
export function StatusFilters({
  onStatusChange,
  onPlatformChange,
  initialStatuses = [],
  initialPlatforms = [],
}: StatusFiltersProps): React.JSX.Element {
  const [activeStatuses, setActiveStatuses] = useState<Set<ContentStatus>>(
    new Set(initialStatuses),
  );
  const [activePlatforms, setActivePlatforms] = useState<Set<Platform>>(
    new Set(initialPlatforms),
  );

  const toggleStatus = useCallback(
    (status: ContentStatus) => {
      setActiveStatuses((prev) => {
        const next = new Set(prev);
        if (next.has(status)) {
          next.delete(status);
        } else {
          next.add(status);
        }
        onStatusChange?.(Array.from(next));
        return next;
      });
    },
    [onStatusChange],
  );

  const togglePlatform = useCallback(
    (platform: Platform) => {
      setActivePlatforms((prev) => {
        const next = new Set(prev);
        if (next.has(platform)) {
          next.delete(platform);
        } else {
          next.add(platform);
        }
        onPlatformChange?.(Array.from(next));
        return next;
      });
    },
    [onPlatformChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status toggles */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Status:
        </span>
        {STATUS_OPTIONS.map(({ value, label }) => {
          const isActive = activeStatuses.has(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggleStatus(value)}
              aria-pressed={isActive}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Separator */}
      <div className="hidden h-5 w-px bg-border sm:block" />

      {/* Platform toggles */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Platform:
        </span>
        {PLATFORM_OPTIONS.map(({ value, label }) => {
          const isActive = activePlatforms.has(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => togglePlatform(value)}
              aria-pressed={isActive}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
