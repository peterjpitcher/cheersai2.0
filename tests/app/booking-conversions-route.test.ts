import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  updateIs: vi.fn(),
  select: vi.fn(),
  selectEq: vi.fn(),
  maybeSingle: vi.fn(),
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
  gclid: 'gclid-123',
  shortCode: 'ma-quiz',
  attributionCapturedAt: '2026-05-10T18:45:00.000Z',
  attributionUpdatedAt: '2026-05-10T18:55:00.000Z',
  occurredAt: '2026-05-10T19:01:00.000Z',
};

describe('POST /api/booking-conversions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BOOKING_CONVERSION_INGEST_SECRET', 'secret-123');
    vi.stubEnv('BOOKING_CONVERSION_ACCOUNT_ID', '00000000-0000-0000-0000-000000000123');
    vi.stubGlobal('fetch', vi.fn());
    mocks.update.mockReturnValue({ eq: mocks.updateEq });
    mocks.updateEq.mockReturnValue({ eq: mocks.updateEq, is: mocks.updateIs });
    mocks.updateIs.mockResolvedValue({ error: null });
    mocks.select.mockReturnValue({ eq: mocks.selectEq });
    mocks.selectEq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'meta_ad_accounts') return { select: mocks.select };
      return { upsert: mocks.upsert, update: mocks.update };
    });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
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
        utm_content: 'ad-1',
        utm_term: 'quiz',
        fbclid: 'fb-123',
        gclid: 'gclid-123',
        short_code: 'ma-quiz',
        meta_consent_granted: false,
        attribution_captured_at: '2026-05-10T18:45:00.000Z',
        attribution_updated_at: '2026-05-10T18:55:00.000Z',
      }),
      { onConflict: 'account_id,booking_id' },
    );
    expect(JSON.stringify(mocks.upsert.mock.calls[0]?.[0])).not.toMatch(/07700900000|Jane|Smith|@/);
  });

  it('forwards consented booking conversions to Meta CAPI with event id dedupe', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: {
        meta_pixel_id: '123456789012345',
        conversions_api_access_token: 'capi-token-1234567890',
      },
      error: null,
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));

    const response = await POST(makeRequest({
      ...validPayload,
      metaConsentGranted: true,
      fbp: 'fb.1.1710000000.abc',
      fbc: 'fb.1.1710000000.fbclid-123',
      clientUserAgent: 'Mozilla/5.0 Test',
    }));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/123456789012345/events?access_token=capi-token-1234567890'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const capiBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(capiBody.data[0]).toMatchObject({
      event_name: 'Purchase',
      event_id: 'EVT-123',
      action_source: 'website',
      user_data: {
        fbp: 'fb.1.1710000000.abc',
        fbc: 'fb.1.1710000000.fbclid-123',
        client_user_agent: 'Mozilla/5.0 Test',
      },
      custom_data: {
        value: 12,
        currency: 'GBP',
        order_id: 'EVT-123',
      },
    });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      capi_status: 'sent',
      capi_event_id: 'EVT-123',
      capi_error: null,
    }));
  });

  it('surfaces storage failures cleanly', async () => {
    mocks.upsert.mockResolvedValueOnce({ error: { message: 'database unavailable' } });

    const response = await POST(makeRequest(validPayload));

    expect(response.status).toBe(500);
  });
});
