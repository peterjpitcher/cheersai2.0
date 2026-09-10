/**
 * Tests for POST /api/booking-conversions — the ingest endpoint the-anchor.pub
 * calls for every confirmed booking. Locks the contract for auth, validation,
 * consent gating, pre-migration schema compatibility, and CAPI status writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServiceSupabaseClientMock, forwardToCapiMock } = vi.hoisted(() => ({
  createServiceSupabaseClientMock: vi.fn(),
  forwardToCapiMock: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: createServiceSupabaseClientMock,
}));

vi.mock('@/lib/meta/conversions-api', () => ({
  forwardBookingConversionToMetaCapi: forwardToCapiMock,
}));

import { POST } from '@/app/api/booking-conversions/route';

const SECRET = 'test-ingest-secret';
const ACCOUNT_ID = '91fda684-2801-4abb-980e-f42cec017cef';
const VALID_SHA256 = 'b'.repeat(64);

interface CapturedCalls {
  upserts: Array<{ payload: Record<string, unknown>; options: unknown }>;
  updates: Array<{ payload: Record<string, unknown>; filters: Array<[string, string, unknown]> }>;
}

// Thenable builder that mimics the supabase-js query chain closely enough for the
// route: from().upsert(...) and from().update(...).eq(...).eq(...)[.is(...)].
function buildSupabaseMock(captured: CapturedCalls) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      upsert: vi.fn((payload: Record<string, unknown>, options: unknown) => {
        captured.upserts.push({ payload, options });
        return Promise.resolve({ error: null });
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        const entry = { payload, filters: [] as Array<[string, string, unknown]> };
        captured.updates.push(entry);
        const builder = {
          eq(column: string, value: unknown) {
            entry.filters.push(['eq', column, value]);
            return builder;
          },
          is(column: string, value: unknown) {
            entry.filters.push(['is', column, value]);
            return builder;
          },
          then(resolve: (value: { error: null }) => void) {
            resolve({ error: null });
          },
        };
        return builder;
      }),
    })),
  };
}

function makeRequest(body: unknown, secret: string | null = SECRET) {
  return new Request('https://cheers.orangejelly.co.uk/api/booking-conversions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/booking-conversions', () => {
  let captured: CapturedCalls;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOOKING_CONVERSION_INGEST_SECRET = SECRET;
    process.env.BOOKING_CONVERSION_ACCOUNT_ID = ACCOUNT_ID;
    captured = { upserts: [], updates: [] };
    createServiceSupabaseClientMock.mockReturnValue(buildSupabaseMock(captured));
    forwardToCapiMock.mockResolvedValue({ status: 'sent', eventId: 'TB-1' });
  });

  it('rejects with 401 when no legacy env secret and no matching per-brand key', async () => {
    // The legacy env path is now optional (per-brand ingest keys). With no env
    // secret and no brand whose booking_ingest_secret matches, the request is
    // simply unauthorized -- not a 500 misconfiguration.
    delete process.env.BOOKING_CONVERSION_INGEST_SECRET;
    const response = await POST(makeRequest({ bookingId: 'TB-1' }));
    expect(response.status).toBe(401);
  });

  it('rejects a wrong bearer secret with 401', async () => {
    const response = await POST(makeRequest({ bookingId: 'TB-1' }, 'wrong-secret'));
    expect(response.status).toBe(401);
    expect(captured.upserts).toHaveLength(0);
  });

  it('rejects invalid payloads with 400', async () => {
    const response = await POST(makeRequest({ bookingId: '' }));
    expect(response.status).toBe(400);
  });

  it('rejects raw (unhashed) email values with 400', async () => {
    const response = await POST(makeRequest({
      bookingId: 'TB-1',
      metaConsentGranted: true,
      emailSha256: 'peter@example.com',
    }));
    expect(response.status).toBe(400);
  });

  it('stores non-consented events, marks them skipped/no_consent, and never calls CAPI', async () => {
    const response = await POST(makeRequest({
      bookingId: 'TB-2',
      bookingType: 'table',
      metaConsentGranted: false,
      fbp: 'fb.1.1.1',
      utmSource: 'facebook',
    }));

    expect(response.status).toBe(200);
    expect(forwardToCapiMock).not.toHaveBeenCalled();

    const upsert = captured.upserts[0]!;
    expect(upsert.payload).toMatchObject({
      account_id: ACCOUNT_ID,
      booking_id: 'TB-2',
      meta_consent_granted: false,
      fbp: null, // consent-gated
      utm_source: 'facebook', // attribution kept for reporting
    });

    const skipUpdate = captured.updates[0]!;
    expect(skipUpdate.payload).toMatchObject({ capi_status: 'skipped', capi_error: 'no_consent' });
    // Must never downgrade a row that already recorded a send.
    expect(skipUpdate.filters).toContainEqual(['is', 'capi_status', null]);
  });

  it('omits advanced-matching columns entirely when not supplied (pre-migration compatibility)', async () => {
    await POST(makeRequest({ bookingId: 'TB-3', metaConsentGranted: true, fbp: 'fb.1.1.1' }));
    const upsert = captured.upserts[0]!;
    expect('email_sha256' in upsert.payload).toBe(false);
    expect('phone_sha256' in upsert.payload).toBe(false);
    expect('client_ip_address' in upsert.payload).toBe(false);
  });

  it('forwards consented events to CAPI with hashed match keys and records the sent status', async () => {
    const response = await POST(makeRequest({
      bookingId: 'TB-4',
      bookingType: 'event',
      eventName: 'Quiz Night',
      value: 20,
      metaConsentGranted: true,
      fbp: 'fb.1.1.1',
      clientUserAgent: 'Mozilla/5.0',
      emailSha256: VALID_SHA256.toUpperCase(),
      phoneSha256: VALID_SHA256,
      clientIpAddress: '203.0.113.9',
    }));

    expect(response.status).toBe(200);
    const upsert = captured.upserts[0]!;
    expect(upsert.payload).toMatchObject({
      email_sha256: VALID_SHA256, // lowercased at ingest
      phone_sha256: VALID_SHA256,
      client_ip_address: '203.0.113.9',
    });

    expect(forwardToCapiMock).toHaveBeenCalledTimes(1);
    expect(forwardToCapiMock.mock.calls[0]![0].conversion).toMatchObject({
      bookingId: 'TB-4',
      emailSha256: VALID_SHA256,
      phoneSha256: VALID_SHA256,
      clientIpAddress: '203.0.113.9',
    });

    const statusUpdate = captured.updates[0]!;
    expect(statusUpdate.payload).toMatchObject({ capi_status: 'sent' });
  });

  it('records the failure reason when CAPI forwarding fails', async () => {
    forwardToCapiMock.mockResolvedValue({ status: 'failed', eventId: 'TB-5', error: 'Invalid pixel' });
    await POST(makeRequest({ bookingId: 'TB-5', metaConsentGranted: true, fbp: 'fb.1.1.1' }));
    const statusUpdate = captured.updates[0]!;
    expect(statusUpdate.payload).toMatchObject({ capi_status: 'failed', capi_error: 'Invalid pixel' });
  });

  // Regression: the-anchor.pub posts every confirmed booking twice under one reference
  // -- server-side on confirmation, then again from the browser. Between July and
  // September 2026 the browser post carried `tickets: null`, `value: 0` and no booking
  // date, and the upsert wrote those over the real figures. The upsert must be additive:
  // a column a post knows nothing about is left out of the statement entirely.
  describe('a second post for the same booking', () => {
    // The site's server-side send: party size, party size x GBP 25, the booking date.
    const serverPost = {
      bookingId: 'TB-DUPLICATE',
      bookingType: 'table' as const,
      tickets: 6,
      value: 150,
      currency: 'GBP',
      // Late-evening BST, so the stored date differs from the UTC calendar date if it
      // is ever parsed as an instant. It must read 2026-08-15 under TZ=Europe/London
      // and TZ=UTC alike.
      eventDate: '2026-08-15T23:30:00+01:00',
      foodIntent: 'sunday_roast',
      utmCampaign: 'august-roast',
      metaConsentGranted: true,
      fbp: 'fb.1.1.1',
    };

    // The browser send for the same booking reference: it knows the reference and the
    // attribution cookie, and nothing about the covers.
    const browserPost = {
      bookingId: 'TB-DUPLICATE',
      bookingType: 'table' as const,
      tickets: null,
      value: 0,
      metaConsentGranted: true,
      fbp: 'fb.1.1.1',
    };

    it('stores the party size, value and booking date the first post supplies', async () => {
      await POST(makeRequest(serverPost));

      expect(captured.upserts[0]!.payload).toMatchObject({
        booking_id: 'TB-DUPLICATE',
        booking_type: 'table',
        tickets: 6,
        value: 150,
        currency: 'GBP',
        event_date: '2026-08-15',
        food_intent: 'sunday_roast',
      });
      expect(captured.upserts[0]!.options).toEqual({ onConflict: 'account_id,booking_id' });
    });

    it('never blanks the party size, value or booking date an earlier post filled', async () => {
      await POST(makeRequest(serverPost));
      await POST(makeRequest(browserPost));

      const second = captured.upserts[1]!.payload;
      // Omitted, not nulled: PostgREST only puts payload keys into ON CONFLICT DO
      // UPDATE SET, so leaving them out preserves what the first post stored.
      expect('tickets' in second).toBe(false);
      expect('value' in second).toBe(false);
      expect('event_date' in second).toBe(false);
      expect('food_intent' in second).toBe(false);
      // The currency fallback must not overwrite a stored currency either.
      expect('currency' in second).toBe(false);
      // Still the same row, still deduplicated on the booking reference.
      expect(second).toMatchObject({
        account_id: ACCOUNT_ID,
        booking_id: 'TB-DUPLICATE',
        meta_event_id: 'TB-DUPLICATE',
        booking_type: 'table',
      });
      expect(captured.upserts[1]!.options).toEqual({ onConflict: 'account_id,booking_id' });
    });

    it('treats a zero value as unknown rather than as worth nothing', async () => {
      await POST(makeRequest({ bookingId: 'TB-ZERO', bookingType: 'table', value: 0, tickets: 4 }));

      const payload = captured.upserts[0]!.payload;
      expect('value' in payload).toBe(false);
      // A party size is still a fact, so it is written.
      expect(payload).toMatchObject({ tickets: 4 });
    });

    it('still writes attribution a later post does know about', async () => {
      await POST(makeRequest(serverPost));
      await POST(makeRequest({ ...browserPost, utmSource: 'facebook', fbclid: 'fb-123' }));

      expect(captured.upserts[1]!.payload).toMatchObject({
        utm_source: 'facebook',
        fbclid: 'fb-123',
      });
      // The first post's campaign is left alone rather than nulled.
      expect('utm_campaign' in captured.upserts[1]!.payload).toBe(false);
    });

    it('keeps consent gating unchanged: a post without consent still clears the identifiers', async () => {
      await POST(makeRequest(serverPost));
      await POST(makeRequest({ ...browserPost, metaConsentGranted: false, fbp: 'fb.1.1.1' }));

      expect(captured.upserts[1]!.payload).toMatchObject({
        meta_consent_granted: false,
        fbp: null,
        fbc: null,
        client_user_agent: null,
      });
    });

    it('forwards the booking value to CAPI as unknown rather than as zero', async () => {
      await POST(makeRequest(browserPost));

      expect(forwardToCapiMock).toHaveBeenCalledTimes(1);
      expect(forwardToCapiMock.mock.calls[0]![0].conversion).toMatchObject({
        bookingId: 'TB-DUPLICATE',
        metaEventId: 'TB-DUPLICATE',
        value: null,
      });
    });
  });
});
