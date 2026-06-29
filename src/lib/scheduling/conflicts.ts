/**
 * Conflict detection for scheduled content items (SCHED-02).
 *
 * Detects when two items are scheduled within 30 minutes of each other
 * on the same platform. All time comparisons use Europe/London timezone.
 */

import { DateTime } from 'luxon';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { ContentItem, Platform } from '@/types/content';

export interface Conflict {
  itemA: { id: string; title: string | null; scheduledAt: Date };
  itemB: { id: string; title: string | null; scheduledAt: Date };
  platform: Platform;
  gapMinutes: number;
  suggestion: string;
}

const CONFLICT_WINDOW_MINUTES = 30;

/**
 * Extract platforms from a content item's bodyDraft.
 * Falls back to empty array if bodyDraft is missing or malformed.
 */
function extractPlatforms(item: ContentItem): Platform[] {
  const draft = item.bodyDraft as Record<string, unknown> | null;
  if (!draft) return [];
  const platforms = draft.platforms;
  if (!Array.isArray(platforms)) return [];
  return platforms.filter(
    (p): p is Platform =>
      p === 'facebook' || p === 'instagram',
  );
}

/**
 * Detect scheduling conflicts: items on the same platform within 30 minutes.
 *
 * Groups items by platform, sorts by scheduledAt, and checks adjacent pairs.
 * Returns a Conflict entry for each pair that violates the 30-minute window.
 */
export function detectConflicts(items: ContentItem[]): Conflict[] {
  // Filter to items that actually have a valid scheduledAt
  const scheduled = items.filter(
    (item): item is ContentItem & { scheduledAt: Date } =>
      item.scheduledAt instanceof Date && !isNaN(item.scheduledAt.getTime()),
  );

  // Build a list of (item, platform) pairs for grouping
  const entries: Array<{ item: ContentItem & { scheduledAt: Date }; platform: Platform }> = [];
  for (const item of scheduled) {
    const platforms = extractPlatforms(item);
    for (const platform of platforms) {
      entries.push({ item, platform });
    }
  }

  // Group by platform
  const byPlatform = new Map<Platform, Array<ContentItem & { scheduledAt: Date }>>();
  for (const { item, platform } of entries) {
    const group = byPlatform.get(platform) ?? [];
    group.push(item);
    byPlatform.set(platform, group);
  }

  const conflicts: Conflict[] = [];

  for (const [platform, group] of byPlatform) {
    // Sort by scheduledAt ascending using timezone-aware comparison
    const sorted = [...group].sort((a, b) => {
      const dtA = DateTime.fromJSDate(a.scheduledAt, { zone: DEFAULT_TIMEZONE });
      const dtB = DateTime.fromJSDate(b.scheduledAt, { zone: DEFAULT_TIMEZONE });
      return dtA.toMillis() - dtB.toMillis();
    });

    // Compare adjacent pairs
    for (let i = 0; i < sorted.length - 1; i++) {
      const itemA = sorted[i];
      const itemB = sorted[i + 1];

      const dtA = DateTime.fromJSDate(itemA.scheduledAt, { zone: DEFAULT_TIMEZONE });
      const dtB = DateTime.fromJSDate(itemB.scheduledAt, { zone: DEFAULT_TIMEZONE });

      const gapMinutes = Math.round(dtB.diff(dtA, 'minutes').minutes);

      if (gapMinutes < CONFLICT_WINDOW_MINUTES) {
        // Suggest moving itemB to 30 minutes after itemA
        const suggestedTime = dtA.plus({ minutes: CONFLICT_WINDOW_MINUTES });
        const suggestion = `Move '${itemB.title ?? 'Untitled'}' to ${suggestedTime.toFormat('HH:mm')}`;

        conflicts.push({
          itemA: { id: itemA.id, title: itemA.title, scheduledAt: itemA.scheduledAt },
          itemB: { id: itemB.id, title: itemB.title, scheduledAt: itemB.scheduledAt },
          platform,
          gapMinutes,
          suggestion,
        });
      }
    }
  }

  return conflicts;
}

// Re-export v1 types for backward compatibility
export type { ScheduledSlot, ConflictResult } from '@/lib/scheduling/conflicts-v1';
export { resolveConflicts } from '@/lib/scheduling/conflicts-v1';
