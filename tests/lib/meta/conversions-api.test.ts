import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forwardBookingConversionToMetaCapi } from '@/lib/meta/conversions-api';
import type { BookingConversionForCapi } from '@/lib/meta/conversions-api';

const VALID_SHA256 = 'a'.repeat(64);

function buildSupabaseMock(row: { meta_pixel_id?: string | null; conversions_api_access_token?: string | null } | null = {
  meta_pixel_id: 'pixel-123',
  conversions_api_access_token: 'capi-token',
}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: row, error: null })),
        })),
      })),
    })),
  } as never;
}

function baseConversion(overrides?: Partial<BookingConversionForCapi>): BookingConversionForCapi {
  return {
    bookingId: 'TB-100',
    metaEventId: 'TB-100',
    bookingType: 'table',
    occurredAt: '2026-07-07T12:00:00.000Z',
    metaConsentGranted: true,
    fbp: 'fb.1.123.456',
    fbc: null,
    clientUserAgent: 'Mozilla/5.0',
    value: 25,
    currency: 'gbp',
    ...overrides,
  };
}

describe('forwardBookingConversionToMetaCapi', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips with no_consent when consent is not explicitly granted', async () => {
    const result = await forwardBookingConversionToMetaCapi({
      supabase: buildSupabaseMock(),
      accountId: 'acc-1',
      conversion: baseConversion({ metaConsentGranted: false }),
    });
    expect(result).toEqual({ status: 'skipped', reason: 'no_consent' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips with missing_match_keys when only a user agent is available', async () => {
    const result = await forwardBookingConversionToMetaCapi({
      supabase: buildSupabaseMock(),
      accountId: 'acc-1',
      conversion: baseConversion({ fbp: null, fbc: null, clientUserAgent: 'Mozilla/5.0' }),
    });
    expect(result).toEqual({ status: 'skipped', reason: 'missing_match_keys' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a hashed email as a sufficient match key', async () => {
    const result = await forwardBookingConversionToMetaCapi({
      supabase: buildSupabaseMock(),
      accountId: 'acc-1',
      conversion: baseConversion({ fbp: null, clientUserAgent: null, emailSha256: VALID_SHA256 }),
    });
    expect(result.status).toBe('sent');
  });

  it('drops malformed hash values instead of forwarding them', async () => {
    const result = await forwardBookingConversionToMetaCapi({
      supabase: buildSupabaseMock(),
      accountId: 'acc-1',
      conversion: baseConversion({
        fbp: null,
        clientUserAgent: null,
        emailSha256: 'peter@example.com', // raw value, not a digest
      }),
    });
    expect(result).toEqual({ status: 'skipped', reason: 'missing_match_keys' });
  });

  it('skips with not_configured when the pixel or CAPI token is absent', async () => {
    const result = await forwardBookingConversionToMetaCapi({
      supabase: buildSupabaseMock({ meta_pixel_id: 'pixel-123', conversions_api_access_token: null }),
      accountId: 'acc-1',
      conversion: baseConversion(),
    });
    expect(result).toEqual({ status: 'skipped', reason: 'not_configured' });
  });

  it('sends a Purchase event with all supplied match keys and custom data', async () => {
    const result = await forwardBookingConversionToMetaCapi({
      supabase: buildSupabaseMock(),
      accountId: 'acc-1',
      conversion: baseConversion({
        emailSha256: VALID_SHA256.toUpperCase(),
        phoneSha256: VALID_SHA256,
        clientIpAddress: '203.0.113.7',
        eventName: 'Quiz Night',
        tickets: 4,
      }),
    });

    expect(result).toEqual({ status: 'sent', eventId: 'TB-100' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/pixel-123/events');
    const body = JSON.parse((init as { body: string }).body);
    const event = body.data[0];
    expect(event.event_name).toBe('Purchase');
    expect(event.event_id).toBe('TB-100');
    expect(event.action_source).toBe('website');
    expect(event.user_data).toMatchObject({
      fbp: 'fb.1.123.456',
      client_user_agent: 'Mozilla/5.0',
      em: VALID_SHA256, // lowercased
      ph: VALID_SHA256,
      client_ip_address: '203.0.113.7',
    });
    expect(event.custom_data).toMatchObject({
      currency: 'GBP',
      value: 25,
      order_id: 'TB-100',
      content_name: 'Quiz Night',
      num_items: 4,
    });
  });

  it('returns failed with the Meta error message on API errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid pixel' } }),
    });
    const result = await forwardBookingConversionToMetaCapi({
      supabase: buildSupabaseMock(),
      accountId: 'acc-1',
      conversion: baseConversion(),
    });
    expect(result).toEqual({ status: 'failed', eventId: 'TB-100', error: 'Invalid pixel' });
  });
});
