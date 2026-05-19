'use client';

import { useState, useMemo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import type { BestTimeSlot } from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// 7x24 heatmap for best posting times (custom CSS grid, NOT Recharts)
// ---------------------------------------------------------------------------

interface BestTimeHeatmapProps {
  data: BestTimeSlot[];
  loading?: boolean;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => i);

interface HoveredCell {
  dayOfWeek: number;
  hour: number;
  rate: number;
  postCount: number;
  x: number;
  y: number;
}

/**
 * Build a lookup map from day+hour to engagement data.
 * dayOfWeek in BestTimeSlot uses 0=Sun convention from aggregations.ts
 * We remap: Mon=1, Tue=2, ..., Sat=6, Sun=0 -> row indices 0-6 (Mon-Sun)
 */
function buildGrid(data: BestTimeSlot[]): Map<string, BestTimeSlot> {
  const map = new Map<string, BestTimeSlot>();
  for (const slot of data) {
    // Remap: 0(Sun)->6, 1(Mon)->0, 2(Tue)->1, ... 6(Sat)->5
    const rowIndex = slot.dayOfWeek === 0 ? 6 : slot.dayOfWeek - 1;
    map.set(`${rowIndex}-${slot.hour}`, slot);
  }
  return map;
}

/**
 * Interpolate colour intensity from white to brand primary based on value 0-1.
 */
function cellColour(ratio: number): string {
  if (ratio === 0) return 'hsl(var(--muted))';
  // Blend toward primary using opacity
  const alpha = Math.max(0.15, Math.min(1, ratio));
  return `hsl(var(--primary) / ${alpha})`;
}

/**
 * 7-row (Mon-Sun) x 24-column (00:00-23:00) heatmap.
 * Cell colour intensity based on avgEngagementRate.
 * Tooltip on hover shows day, time, rate, and post count.
 */
export function BestTimeHeatmap({ data, loading }: BestTimeHeatmapProps) {
  const [hovered, setHovered] = useState<HoveredCell | null>(null);

  const { grid, maxRate } = useMemo(() => {
    const g = buildGrid(data);
    let max = 0;
    for (const slot of data) {
      if (slot.avgEngagementRate > max) max = slot.avgEngagementRate;
    }
    return { grid: g, maxRate: max };
  }, [data]);

  if (loading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  if (data.length === 0) return null;

  return (
    <div className="relative overflow-x-auto">
      {/* Hour labels row */}
      <div className="ml-12 flex">
        {HOUR_LABELS.map((h) => (
          <div
            key={h}
            className="flex-1 text-center text-[10px] text-muted-foreground"
            style={{ minWidth: 24 }}
          >
            {h % 3 === 0 ? `${String(h).padStart(2, '0')}` : ''}
          </div>
        ))}
      </div>

      {/* Grid rows */}
      {DAY_LABELS.map((day, rowIndex) => (
        <div key={day} className="flex items-center">
          <div className="w-12 shrink-0 pr-2 text-right text-xs font-medium text-muted-foreground">
            {day}
          </div>
          <div className="flex flex-1">
            {HOUR_LABELS.map((hour) => {
              const key = `${rowIndex}-${hour}`;
              const slot = grid.get(key);
              const rate = slot?.avgEngagementRate ?? 0;
              const ratio = maxRate > 0 ? rate / maxRate : 0;

              return (
                <div
                  key={hour}
                  className="m-px rounded-sm transition-colors"
                  style={{
                    flex: 1,
                    minWidth: 20,
                    height: 28,
                    backgroundColor: cellColour(ratio),
                    cursor: slot ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => {
                    if (!slot) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHovered({
                      dayOfWeek: rowIndex,
                      hour,
                      rate: slot.avgEngagementRate,
                      postCount: slot.postCount,
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Tooltip */}
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-popover px-3 py-2 shadow-md"
          style={{
            left: hovered.x,
            top: hovered.y - 64,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-xs font-medium text-foreground">
            {DAY_LABELS[hovered.dayOfWeek]} {String(hovered.hour).padStart(2, '0')}:00
          </p>
          <p className="text-xs text-muted-foreground">
            Avg engagement: {(hovered.rate * 100).toFixed(1)}% ({hovered.postCount} posts)
          </p>
        </div>
      )}
    </div>
  );
}
