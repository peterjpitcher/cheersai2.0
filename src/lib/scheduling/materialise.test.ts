import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { materialiseRecurring } from '@/lib/scheduling/materialise';
import type { ContentItem } from '@/types/content';

/** Factory: create a minimal recurring ContentItem */
function makeRecurring(overrides: Partial<ContentItem> & { id: string }): ContentItem {
  return {
    accountId: 'acct-1',
    contentType: 'weekly_recurring',
    status: 'approved',
    title: `Recurring ${overrides.id}`,
    bodyDraft: {
      platforms: ['facebook'],
      recurringTime: '12:00',
      weeksAhead: 4,
    },
    campaignName: null,
    scheduledAt: null,
    eventDate: null,
    eventEndDate: null,
    couponCode: null,
    recurringDayOfWeek: 1, // Monday
    autoConfirm: true,
    aiGenerationParams: null,
    thumbnailUrl: null,
    placement: 'feed',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('materialiseRecurring', () => {
  it('expands a weekly campaign into 4 individual slots', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-1',
        recurringDayOfWeek: 1, // Monday
        bodyDraft: { platforms: ['facebook'], recurringTime: '12:00', weeksAhead: 4 },
      }),
    ];

    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' }); // Monday
    const rangeEnd = DateTime.fromISO('2026-05-03', { zone: 'Europe/London' });   // 4 weeks later

    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd);
    expect(slots).toHaveLength(4);
    expect(slots.every((s) => s.contentType === 'weekly_recurring')).toBe(true);
    expect(slots.every((s) => s.sourceId === 'rec-1')).toBe(true);
  });

  it('respects dayOfWeek and time with Europe/London timezone', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-2',
        recurringDayOfWeek: 3, // Wednesday
        bodyDraft: { platforms: ['instagram'], recurringTime: '14:30', weeksAhead: 4 },
      }),
    ];

    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' });
    const rangeEnd = DateTime.fromISO('2026-05-03', { zone: 'Europe/London' });

    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd);

    for (const slot of slots) {
      const dt = DateTime.fromJSDate(slot.scheduledAt, { zone: 'Europe/London' });
      expect(dt.weekday).toBe(3); // Wednesday
      expect(dt.hour).toBe(14);
      expect(dt.minute).toBe(30);
    }
  });

  it('uses weeksAhead count correctly', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-3',
        recurringDayOfWeek: 5, // Friday
        bodyDraft: { platforms: ['facebook'], recurringTime: '09:00', weeksAhead: 2 },
      }),
    ];

    // Range is 6 weeks but weeksAhead=2 should limit to 2 slots
    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' });
    const rangeEnd = DateTime.fromISO('2026-05-17', { zone: 'Europe/London' });

    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd);
    expect(slots.length).toBeLessThanOrEqual(2);
  });

  it('preserves status from the source campaign', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-4',
        status: 'draft',
        recurringDayOfWeek: 1,
        bodyDraft: { platforms: ['facebook'], recurringTime: '10:00', weeksAhead: 4 },
      }),
    ];

    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' });
    const rangeEnd = DateTime.fromISO('2026-05-03', { zone: 'Europe/London' });

    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd);
    expect(slots.every((s) => s.status === 'draft')).toBe(true);
  });

  it('returns empty array for items with no recurringDayOfWeek', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-5',
        recurringDayOfWeek: null,
        bodyDraft: { platforms: ['facebook'], recurringTime: '10:00', weeksAhead: 4 },
      }),
    ];

    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' });
    const rangeEnd = DateTime.fromISO('2026-05-03', { zone: 'Europe/London' });

    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd);
    expect(slots).toEqual([]);
  });

  it('carries thumbnailUrl from provided map', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-6',
        recurringDayOfWeek: 1,
        bodyDraft: { platforms: ['facebook'], recurringTime: '12:00', weeksAhead: 2 },
      }),
    ];

    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' });
    const rangeEnd = DateTime.fromISO('2026-05-03', { zone: 'Europe/London' });

    const thumbnails = new Map([['rec-6', 'https://signed/thumb.jpg']]);
    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd, thumbnails);

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.thumbnailUrl === 'https://signed/thumb.jpg')).toBe(true);
  });

  it('falls back to item.thumbnailUrl when map has no entry', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-7',
        recurringDayOfWeek: 1,
        thumbnailUrl: 'https://fallback/thumb.jpg',
        bodyDraft: { platforms: ['facebook'], recurringTime: '12:00', weeksAhead: 2 },
      }),
    ];

    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' });
    const rangeEnd = DateTime.fromISO('2026-05-03', { zone: 'Europe/London' });

    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd, new Map());

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.thumbnailUrl === 'https://fallback/thumb.jpg')).toBe(true);
  });

  it('returns null thumbnailUrl when no map provided and item has none', () => {
    const recurring = [
      makeRecurring({
        id: 'rec-8',
        recurringDayOfWeek: 1,
        thumbnailUrl: null,
        bodyDraft: { platforms: ['facebook'], recurringTime: '12:00', weeksAhead: 2 },
      }),
    ];

    const rangeStart = DateTime.fromISO('2026-04-06', { zone: 'Europe/London' });
    const rangeEnd = DateTime.fromISO('2026-05-03', { zone: 'Europe/London' });

    const slots = materialiseRecurring(recurring, rangeStart, rangeEnd);

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.thumbnailUrl === null)).toBe(true);
  });
});
