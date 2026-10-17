import { describe, expect, it, vi } from 'vitest';

import {
  beforePromotionWindow,
  promotionWindowFrom,
  promotionWindowMessage,
  type WindowEvent,
} from '@/lib/management-app/promotion-window';

const listManagementEvents = vi.fn();
vi.mock('@/lib/management-app/client', () => ({
  listManagementEvents: (...args: unknown[]) => listManagementEvents(...args),
}));

const events: WindowEvent[] = [
  { id: 'mb-sep', name: 'Detention Disco', date: '2026-09-11', categoryName: 'Music Bingo', categorySlug: 'music-bingo' },
  { id: 'mb-oct', name: 'Monster Mash', date: '2026-10-16', categoryName: 'Music Bingo', categorySlug: 'music-bingo' },
  { id: 'mb-nov', name: 'Sequins & Showstoppers', date: '2026-11-13', categoryName: 'Music Bingo', categorySlug: 'music-bingo' },
  { id: 'cb-nov', name: 'Snowball Showdown', date: '2026-11-18', categoryName: 'Cash Bingo', categorySlug: 'cash-bingo' },
];

describe('promotionWindowFrom', () => {
  it('opens the day after the last event of the same type', () => {
    expect(promotionWindowFrom(events, { eventId: 'mb-dec', eventDate: '2026-12-11', categorySlug: 'music-bingo', categoryName: 'Music Bingo' })).toEqual({
      opensOn: '2026-11-14',
      afterEvent: 'Sequins & Showstoppers',
      afterDate: '2026-11-13',
      category: 'Music Bingo',
    });
  });

  it('ignores other types, the event itself and later events', () => {
    const window = promotionWindowFrom(events, { eventId: 'mb-nov', eventDate: '2026-11-13', categorySlug: 'music-bingo' });
    expect(window?.afterEvent).toBe('Monster Mash');
    expect(window?.opensOn).toBe('2026-10-17');
  });

  it('matches on the category name when there is no slug', () => {
    expect(promotionWindowFrom(events, { eventDate: '2026-12-16', categoryName: 'cash bingo' })?.opensOn).toBe('2026-11-19');
  });

  it('counts a cancelled event as the last of its type', () => {
    // Detention Disco was cancelled; it still closes the window for the next one.
    expect(promotionWindowFrom(events, { eventDate: '2026-10-16', categorySlug: 'music-bingo' })?.afterEvent).toBe('Detention Disco');
  });

  it('cannot apply without a category, a valid date, or an earlier event', () => {
    expect(promotionWindowFrom(events, { eventDate: '2026-12-11' })).toBeNull();
    expect(promotionWindowFrom(events, { eventDate: 'soon', categorySlug: 'music-bingo' })).toBeNull();
    expect(promotionWindowFrom(events, { eventDate: '2026-11-20', categorySlug: 'tasting-nights' })).toBeNull();
  });

  it('opens on the right London day across the October clock change', () => {
    // Saturday 24 October 2026 is the last day of British Summer Time.
    const window = promotionWindowFrom(
      [{ id: 'q', name: 'Spooky Quiz', date: '2026-10-24', categorySlug: 'quiz' }],
      { eventDate: '2026-11-04', categorySlug: 'quiz' },
    );
    expect(window?.opensOn).toBe('2026-10-25');
  });
});

describe('the window in use', () => {
  const window = { opensOn: '2026-11-14', afterEvent: 'Sequins & Showstoppers', afterDate: '2026-11-13', category: 'Music Bingo' };

  it('refuses only dates before it opens', () => {
    expect(beforePromotionWindow('2026-11-13', window)).toBe(true);
    expect(beforePromotionWindow('2026-11-14', window)).toBe(false);
    expect(beforePromotionWindow('2026-11-13', undefined)).toBe(false);
  });

  it('tells the owner why, in plain words', () => {
    expect(promotionWindowMessage('Sleigh My Name', window)).toBe(
      'Sleigh My Name can be promoted from Saturday 14th November, after the last Music Bingo (Sequins & Showstoppers) on Friday 13th November.',
    );
  });
});

describe('loadPromotionWindow', () => {
  it('looks back 120 days from the day before the event', async () => {
    listManagementEvents.mockResolvedValueOnce(events);
    const { loadPromotionWindow } = await import('@/lib/management-app/promotion-window-loader');
    const config = { baseUrl: 'https://management.example', apiKey: 'test' };

    const window = await loadPromotionWindow(config, { eventId: 'mb-dec', eventDate: '2026-12-11', categorySlug: 'music-bingo' });

    expect(listManagementEvents).toHaveBeenCalledWith(config, { fromDate: '2026-08-13', toDate: '2026-12-10', limit: 100 });
    expect(window?.opensOn).toBe('2026-11-14');
  });

  it('does not call the events system for an event with no category', async () => {
    listManagementEvents.mockClear();
    const { loadPromotionWindow } = await import('@/lib/management-app/promotion-window-loader');
    expect(await loadPromotionWindow({ baseUrl: 'https://management.example', apiKey: 'test' }, { eventDate: '2026-12-11' })).toBeNull();
    expect(listManagementEvents).not.toHaveBeenCalled();
  });
});
