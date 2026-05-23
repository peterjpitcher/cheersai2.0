'use client';

import { useCallback, useState } from 'react';
import type { ContentStatus, Platform } from '@/types/content';
import { ToggleChip } from '@/components/ui/toggle-chip';

/** Status filter options shown in the filter bar */
const STATUS_OPTIONS: Array<{ value: ContentStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
];

/** Platform filter options with display labels */
const PLATFORM_OPTIONS: Array<{ value: Platform; label: string; tone: 'fb' | 'ig' | 'gbp' }> = [
  { value: 'facebook', label: 'Facebook', tone: 'fb' },
  { value: 'instagram', label: 'Instagram', tone: 'ig' },
  { value: 'gbp', label: 'Google', tone: 'gbp' },
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
 * and platform toggles (Facebook, Instagram, GBP) using ToggleChip components.
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
      const next = new Set(activeStatuses);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      setActiveStatuses(next);
      onStatusChange?.(Array.from(next));
    },
    [activeStatuses, onStatusChange],
  );

  const togglePlatform = useCallback(
    (platform: Platform) => {
      const next = new Set(activePlatforms);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      setActivePlatforms(next);
      onPlatformChange?.(Array.from(next));
    },
    [activePlatforms, onPlatformChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status toggles */}
      <div className="flex items-center gap-1.5">
        <span className="eyebrow">
          Status:
        </span>
        {STATUS_OPTIONS.map(({ value, label }) => (
          <ToggleChip
            key={value}
            active={activeStatuses.has(value)}
            onClick={() => toggleStatus(value)}
          >
            {label}
          </ToggleChip>
        ))}
      </div>

      {/* Separator */}
      <div
        className="hidden h-5 sm:block"
        style={{ width: 1, backgroundColor: 'var(--c-line)' }}
      />

      {/* Platform toggles */}
      <div className="flex items-center gap-1.5">
        <span className="eyebrow">
          Platform:
        </span>
        {PLATFORM_OPTIONS.map(({ value, label, tone }) => (
          <ToggleChip
            key={value}
            active={activePlatforms.has(value)}
            onClick={() => togglePlatform(value)}
            tone={tone}
          >
            {label}
          </ToggleChip>
        ))}
      </div>
    </div>
  );
}
