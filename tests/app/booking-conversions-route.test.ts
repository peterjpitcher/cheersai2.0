import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    from: mocks.from,
  })),
}));

import { POST } from '@/app/api/booking-conversions/route';

function makeRequest(body: object, token = 'secret-123') {
  return new Request('http://localhost/api/booking-conversions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  sourceSite: 'www.the-anchor.pub',
  bookingId: 'EVT-123',
  metaEventId: 'EVT-123',
  bookingType: 'event',
  eventId: 'event-1',
  eventSlug: 'quiz-night',
  eventName: 'Quiz Night',
  eventCategoryName: 'Quiz',
  eventCategorySlug: 'quiz',
  eventDate: '2026-05-10T20:00:00+01:00',
  tickets: 2,
  value: 12,
  currency: 'GBP',
  foodIntent: 'planning_to_eat',
  sourceUrl: 'https://www.the-anchor.pub/whats-on/quiz-night?utm_campaign=quiz-night&fbclid=fb-123',
  landingPath: '/whats-on/quiz-night',
  utmSource: 'facebook',
  utmMedium: 'paid_social',
  utmCampaign: 'quiz-night',
  utmContent: 'ad-1',
  utmTerm: 'quiz',
  fbclid: 'fb-123',
  occurredAt: '2026-05-10T19:01:00.000Z',
};

describe('POST /api/booking-conversions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BOOKING_CONVERSION_INGEST_SECRET', 'secret-123');
    vi.stubEnv('BOOKING_CONVERSION_ACCOUNT_ID', '00000000-0000-0000-0000-000000000123');
    mocks.from.mockReturnValue({ upsert: mocks.upsert });
    mocks.upsert.mockResolvedValue({ error: null });
  });

  it('rejects requests without the bearer secret', async () => {
    const response = await POST(makeRequest(validPayload, 'wrong-secret'));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads', async () => {
    const response = await POST(makeRequest({ bookingType: 'event' }));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('upserts non-PII booking conversion metadata by account and booking id', async () => {
    const response = await POST(makeRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mocks.from).toHaveBeenCalledWith('booking_conversion_events');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: '00000000-0000-0000-0000-000000000123',
        source_site: 'www.the-anchor.pub',
        booking_id: 'EVT-123',
        meta_event_id: 'EVT-123',
        booking_type: 'event',
        event_id: 'event-1',
        event_slug: 'quiz-night',
        event_name: 'Quiz Night',
        event_category_name: 'Quiz',
        event_category_slug: 'quiz',
        event_date: '2026-05-10',
        tickets: 2,
        value: 12,
        currency: 'GBP',
        food_intent: 'planning_to_eat',
        utm_source: 'facebook',
        utm_medium: 'paid_social',
        utm_campaign: 'quiz-night',
        fbclid: 'fb-123',
      }),
      { onConflict: 'account_id,booking_id' },
    );
    expect(JSON.stringify(mocks.upsert.mock.calls[0]?.[0])).not.toMatch(/07700900000|Jane|Smith|@/);
  });

  it('surfaces storage failures cleanly', async () => {
    mocks.upsert.mockResolvedValueOnce({ error: { message: 'database unavailable' } });

    const response = await POST(makeRequest(validPayload));

    expect(response.status).toBe(500);
  });
});
