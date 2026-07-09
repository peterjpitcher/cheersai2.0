import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import { materialiseRecurring } from '@/lib/scheduling/materialise';
import type { ContentItem } from '@/types/content';

const TZ = 'Europe/London';

/** Factory: a minimal weekly_recurring ContentItem (planner draft-ghost shape). */
function makeRecurring(overrides: Partial<ContentItem> & { id: string }): ContentItem {
  return {
    accountId: 'acct-1',
    contentType: 'weekly_recurring',
    status: 'approved',
    title: `Recurring ${overrides.id}`,
    bodyDraft: { recurringTime: '12:00', weeksAhead: 4 },
    campaignName: null,
    scheduledAt: null,
    eventDate: null,
    eventEndDate: null,
    couponCode: null,
    recurringDayOfWeek: 1, // Monday (JS convention)
    autoConfirm: true,
    aiGenerationParams: null,
    thumbnailUrl: null,
    placement: 'feed',
    platform: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const isoDates = (slots: { scheduledAt: Date }[]) =>
  slots.map((s) => DateTime.fromJSDate(s.scheduledAt).setZone(TZ).toISODate());

describe('materialiseRecurring', () => {
  const rangeStart = DateTime.fromISO('2026-07-01', { zone: TZ });
  const rangeEnd = DateTime.fromISO('2026-07-31T23:59', { zone: TZ });

  it('generates one Monday slot per week up to weeksAhead, within the range', () => {
    const slots = materialiseRecurring([makeRecurring({ id: 'a' })], rangeStart, rangeEnd);
    expect(isoDates(slots)).toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']);
  });

  it('honours the configured time from bodyDraft.recurringTime', () => {
    const item = makeRecurring({ id: 'a', bodyDraft: { recurringTime: '18:30', weeksAhead: 1 } });
    const [slot] = materialiseRecurring([item], rangeStart, rangeEnd);
    const dt = DateTime.fromJSDate(slot.scheduledAt).setZone(TZ);
    expect(dt.toFormat('HH:mm')).toBe('18:30');
  });

  it('maps Sunday (JS 0) to the correct weekday', () => {
    const item = makeRecurring({ id: 'a', recurringDayOfWeek: 0, bodyDraft: { weeksAhead: 2 } });
    const slots = materialiseRecurring([item], rangeStart, rangeEnd);
    // Sundays in range: 5 Jul, 12 Jul (weeksAhead 2)
    expect(isoDates(slots)).toEqual(['2026-07-05', '2026-07-12']);
  });

  it('skips items without a recurring day (batch-created rows never ghost)', () => {
    const item = makeRecurring({ id: 'a', recurringDayOfWeek: null });
    expect(materialiseRecurring([item], rangeStart, rangeEnd)).toEqual([]);
  });

  it('carries title and status, and prefers the thumbnails map over the item thumbnail', () => {
    const item = makeRecurring({
      id: 'a',
      title: 'Quiz Night',
      status: 'scheduled',
      thumbnailUrl: 'item-thumb.jpg',
      bodyDraft: { weeksAhead: 1 },
    });
    const thumbnails = new Map([['a', 'map-thumb.jpg']]);
    const [slot] = materialiseRecurring([item], rangeStart, rangeEnd, thumbnails);
    expect(slot.title).toBe('Quiz Night');
    expect(slot.status).toBe('scheduled');
    expect(slot.thumbnailUrl).toBe('map-thumb.jpg');
    expect(slot.contentType).toBe('weekly_recurring');
    expect(slot.placement).toBe('feed');
  });

  it('defaults weeksAhead to 4 when bodyDraft omits it', () => {
    const item = makeRecurring({ id: 'a', bodyDraft: { recurringTime: '12:00' } });
    const slots = materialiseRecurring([item], rangeStart, rangeEnd);
    expect(slots).toHaveLength(4);
  });

  it('stops at the range end even when weeksAhead would allow more', () => {
    const item = makeRecurring({ id: 'a', bodyDraft: { weeksAhead: 12 } });
    const shortEnd = DateTime.fromISO('2026-07-14T23:59', { zone: TZ });
    const slots = materialiseRecurring([item], rangeStart, shortEnd);
    expect(isoDates(slots)).toEqual(['2026-07-06', '2026-07-13']);
  });
});
