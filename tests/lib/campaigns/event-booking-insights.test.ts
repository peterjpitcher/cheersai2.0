import { describe, expect, it } from 'vitest';

import {
  buildEventBookingInsights,
  formatEventBookingInsightsForCampaignPrompt,
  type BookingConversionEventRow,
} from '@/lib/campaigns/event-booking-insights';

function row(overrides: Partial<BookingConversionEventRow>): BookingConversionEventRow {
  return {
    booking_id: 'booking',
    booking_type: 'event',
    event_id: null,
    event_slug: null,
    event_name: null,
    event_category_name: null,
    event_category_slug: null,
    event_date: null,
    tickets: 1,
    value: 0,
    currency: 'GBP',
    food_intent: null,
    utm_campaign: null,
    occurred_at: '2026-05-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('event booking insights', () => {
  it('aggregates top categories, events, campaigns, seats, and value over 30 and 90 day windows', () => {
    const insights = buildEventBookingInsights([
      row({
        booking_id: 'b1',
        event_id: 'quiz-1',
        event_name: 'Gavin & Stacy Quiz Night',
        event_category_name: 'Quiz',
        event_category_slug: 'quiz',
        tickets: 4,
        value: 24,
        utm_campaign: 'quiz-paid',
        occurred_at: '2026-05-01T12:00:00.000Z',
      }),
      row({
        booking_id: 'b2',
        event_id: 'quiz-1',
        event_name: 'Gavin & Stacy Quiz Night',
        event_category_name: 'Quiz',
        event_category_slug: 'quiz',
        tickets: 2,
        value: 12,
        utm_campaign: 'quiz-paid',
        occurred_at: '2026-04-20T12:00:00.000Z',
      }),
      row({
        booking_id: 'b3',
        event_id: 'bingo-1',
        event_name: 'Music Bingo',
        event_category_name: 'Bingo',
        event_category_slug: 'bingo',
        tickets: '3',
        value: '18',
        utm_campaign: 'bingo-paid',
        occurred_at: '2026-03-01T12:00:00.000Z',
      }),
      row({
        booking_id: 'old',
        event_id: 'old-1',
        event_name: 'Old Event',
        event_category_name: 'Comedy',
        event_category_slug: 'comedy',
        occurred_at: '2026-01-01T12:00:00.000Z',
      }),
    ], new Date('2026-05-03T12:00:00.000Z'));

    expect(insights.totalBookings30d).toBe(2);
    expect(insights.totalBookings90d).toBe(3);
    expect(insights.totalTickets90d).toBe(9);
    expect(insights.totalValue90d).toBe(54);
    expect(insights.topCategories90d[0]).toMatchObject({
      key: 'quiz',
      name: 'Quiz',
      bookings: 2,
      tickets: 6,
      value: 36,
    });
    expect(insights.topEvents90d[0]).toMatchObject({
      key: 'quiz-1',
      name: 'Gavin & Stacy Quiz Night',
      bookings: 2,
    });
    expect(insights.topCampaigns90d[0]).toMatchObject({
      key: 'quiz-paid',
      bookings: 2,
    });
  });

  it('formats aggregate facts for campaign generation without exposing individual booking ids', () => {
    const insights = buildEventBookingInsights([
      row({
        booking_id: 'sensitive-booking-reference',
        event_id: 'quiz-1',
        event_name: 'Quiz Night',
        event_category_name: 'Quiz',
        event_category_slug: 'quiz',
      }),
    ], new Date('2026-05-03T12:00:00.000Z'));

    const prompt = formatEventBookingInsightsForCampaignPrompt(insights);

    expect(prompt).toContain('Last 90 days: 1 tracked event bookings');
    expect(prompt).toContain('Top event categories: Quiz (1 bookings).');
    expect(prompt).toContain('Top booked events: Quiz Night (1 bookings).');
    expect(prompt).not.toContain('sensitive-booking-reference');
  });
});
