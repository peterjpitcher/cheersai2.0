import { describe, it, expect } from 'vitest';
import { detectConflicts } from '@/lib/scheduling/conflicts';
import type { ContentItem } from '@/types/content';

/** Factory: create a minimal ContentItem with a scheduledAt date */
function makeItem(overrides: Partial<ContentItem> & { id: string; scheduledAt: Date }): ContentItem {
  return {
    accountId: 'acct-1',
    contentType: 'instant_post',
    status: 'scheduled',
    title: `Item ${overrides.id}`,
    bodyDraft: { platforms: ['facebook'] },
    campaignName: null,
    eventDate: null,
    eventEndDate: null,
    couponCode: null,
    recurringDayOfWeek: null,
    autoConfirm: false,
    aiGenerationParams: null,
    thumbnailUrl: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('detectConflicts', () => {
  it('returns empty array when no items overlap', () => {
    const items = [
      makeItem({
        id: 'a',
        scheduledAt: new Date('2026-04-10T10:00:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
      makeItem({
        id: 'b',
        scheduledAt: new Date('2026-04-10T11:00:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
    ];

    const conflicts = detectConflicts(items);
    expect(conflicts).toEqual([]);
  });

  it('detects two items on same platform within 30 minutes', () => {
    const items = [
      makeItem({
        id: 'a',
        scheduledAt: new Date('2026-04-10T10:00:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
      makeItem({
        id: 'b',
        scheduledAt: new Date('2026-04-10T10:20:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
    ];

    const conflicts = detectConflicts(items);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].platform).toBe('facebook');
    expect(conflicts[0].gapMinutes).toBe(20);
  });

  it('does NOT flag items on different platforms at same time', () => {
    const items = [
      makeItem({
        id: 'a',
        scheduledAt: new Date('2026-04-10T10:00:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
      makeItem({
        id: 'b',
        scheduledAt: new Date('2026-04-10T10:00:00Z'),
        bodyDraft: { platforms: ['instagram'] },
      }),
    ];

    const conflicts = detectConflicts(items);
    expect(conflicts).toEqual([]);
  });

  it('suggests resolution offset (move 30 mins later)', () => {
    const items = [
      makeItem({
        id: 'a',
        scheduledAt: new Date('2026-04-10T10:00:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
      makeItem({
        id: 'b',
        scheduledAt: new Date('2026-04-10T10:15:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
    ];

    const conflicts = detectConflicts(items);
    expect(conflicts).toHaveLength(1);
    // April is BST (+1): 10:00 UTC = 11:00 BST, suggestion is +30min = 11:30 BST
    expect(conflicts[0].suggestion).toContain('11:30');
  });

  it('handles timezone correctly (BST vs GMT edge case)', () => {
    // March 29 2026 is GMT, March 30 is BST (clocks go forward)
    // Two items 20 mins apart spanning the transition should still be detected
    const items = [
      makeItem({
        id: 'a',
        scheduledAt: new Date('2026-03-29T00:50:00Z'), // 00:50 GMT
        bodyDraft: { platforms: ['facebook'] },
      }),
      makeItem({
        id: 'b',
        scheduledAt: new Date('2026-03-29T01:05:00Z'), // 01:05 GMT (still same day in London)
        bodyDraft: { platforms: ['facebook'] },
      }),
    ];

    const conflicts = detectConflicts(items);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].gapMinutes).toBe(15);
  });

  it('handles items with null scheduledAt gracefully', () => {
    const items = [
      makeItem({
        id: 'a',
        scheduledAt: null as unknown as Date,
        bodyDraft: { platforms: ['facebook'] },
      }),
      makeItem({
        id: 'b',
        scheduledAt: new Date('2026-04-10T10:00:00Z'),
        bodyDraft: { platforms: ['facebook'] },
      }),
    ];

    const conflicts = detectConflicts(items);
    expect(conflicts).toEqual([]);
  });

  it('detects multiple conflicts across platforms', () => {
    const items = [
      makeItem({
        id: 'a',
        scheduledAt: new Date('2026-04-10T10:00:00Z'),
        bodyDraft: { platforms: ['facebook', 'instagram'] },
      }),
      makeItem({
        id: 'b',
        scheduledAt: new Date('2026-04-10T10:10:00Z'),
        bodyDraft: { platforms: ['facebook', 'instagram'] },
      }),
    ];

    const conflicts = detectConflicts(items);
    // Should detect conflicts on both facebook and instagram
    expect(conflicts).toHaveLength(2);
    const platforms = conflicts.map((c) => c.platform).sort();
    expect(platforms).toEqual(['facebook', 'instagram']);
  });
});
