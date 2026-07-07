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
  return new Request('https://www.cheersai.uk/api/booking-conversions', {
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

  it('returns 500 with a clear message when the ingest secret is not configured', async () => {
    delete process.env.BOOKING_CONVERSION_INGEST_SECRET;
    const response = await POST(makeRequest({ bookingId: 'TB-1' }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('BOOKING_CONVERSION_INGEST_SECRET');
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
});
