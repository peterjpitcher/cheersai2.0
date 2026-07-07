/**
 * Tests for GET/POST /api/cron/retry-capi-conversions — the hourly retry/backfill
 * job that re-forwards consented booking conversions whose CAPI send failed or
 * never happened, within Meta's 7-day acceptance window.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServiceSupabaseClientMock, forwardToCapiMock, verifyCronAuthMock } = vi.hoisted(() => ({
  createServiceSupabaseClientMock: vi.fn(),
  forwardToCapiMock: vi.fn(),
  verifyCronAuthMock: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: createServiceSupabaseClientMock,
}));

vi.mock('@/lib/meta/conversions-api', () => ({
  forwardBookingConversionToMetaCapi: forwardToCapiMock,
}));

vi.mock('@/lib/security/cron-auth', () => ({
  verifyCronAuth: verifyCronAuthMock,
}));

import { GET } from '@/app/api/cron/retry-capi-conversions/route';

function makeRow(overrides?: Record<string, unknown>) {
  return {
    account_id: 'acc-1',
    booking_id: 'TB-1',
    meta_event_id: 'TB-1',
    booking_type: 'table',
    event_name: null,
    event_category_name: null,
    tickets: null,
    value: '25.00', // numeric columns come back as strings
    currency: 'GBP',
    source_url: null,
    occurred_at: '2026-07-06T18:00:00.000Z',
    meta_consent_granted: true,
    fbp: 'fb.1.1.1',
    fbc: null,
    client_user_agent: 'Mozilla/5.0',
    capi_status: 'failed',
    capi_error: 'Meta CAPI returned 500',
    ...overrides,
  };
}

interface Captured {
  updates: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }>;
  orFilter?: string;
}

function buildSupabaseMock(rows: Record<string, unknown>[], captured: Captured) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          or: vi.fn((filter: string) => {
            captured.orFilter = filter;
            return {
              gte: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: rows, error: null })),
                })),
              })),
            };
          }),
        })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        const entry = { payload, filters: [] as Array<[string, unknown]> };
        captured.updates.push(entry);
        const builder = {
          eq(column: string, value: unknown) {
            entry.filters.push([column, value]);
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

function makeRequest() {
  return new Request('https://www.cheersai.uk/api/cron/retry-capi-conversions');
}

describe('retry-capi-conversions cron', () => {
  let captured: Captured;

  beforeEach(() => {
    vi.clearAllMocks();
    captured = { updates: [] };
    verifyCronAuthMock.mockReturnValue({ authorised: true });
  });

  it('rejects unauthorised requests', async () => {
    verifyCronAuthMock.mockReturnValue({ authorised: false, errorMessage: 'nope', errorStatus: 401 });
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
  });

  it('re-forwards eligible rows and records a successful send', async () => {
    createServiceSupabaseClientMock.mockReturnValue(buildSupabaseMock([makeRow()], captured));
    forwardToCapiMock.mockResolvedValue({ status: 'sent', eventId: 'TB-1' });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body).toMatchObject({ attempted: 1, sent: 1, failed: 0, skipped: 0 });
    // Lock the PostgREST eligibility filter — a typo here silently retries nothing.
    expect(captured.orFilter).toBe(
      'capi_status.is.null,capi_status.eq.failed,and(capi_status.eq.skipped,capi_error.eq.not_configured)',
    );
    expect(forwardToCapiMock).toHaveBeenCalledTimes(1);
    const conversion = forwardToCapiMock.mock.calls[0]![0].conversion;
    expect(conversion.value).toBe(25); // numeric string normalised
    expect(conversion.bookingId).toBe('TB-1');

    const update = captured.updates[0]!;
    expect(update.payload).toMatchObject({ capi_status: 'sent', capi_error: null });
    expect(update.filters).toContainEqual(['account_id', 'acc-1']);
    expect(update.filters).toContainEqual(['booking_id', 'TB-1']);
  });

  it('leaves not_configured rows untouched so they stay retryable once CAPI is set up', async () => {
    createServiceSupabaseClientMock.mockReturnValue(buildSupabaseMock([makeRow()], captured));
    forwardToCapiMock.mockResolvedValue({ status: 'skipped', reason: 'not_configured' });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body).toMatchObject({ attempted: 1, sent: 0, failed: 0, skipped: 1 });
    expect(captured.updates).toHaveLength(0);
  });

  it('marks permanent skips (missing match keys) so they stop being retried', async () => {
    createServiceSupabaseClientMock.mockReturnValue(buildSupabaseMock([makeRow()], captured));
    forwardToCapiMock.mockResolvedValue({ status: 'skipped', reason: 'missing_match_keys' });

    await GET(makeRequest());
    const update = captured.updates[0]!;
    expect(update.payload).toMatchObject({ capi_status: 'skipped', capi_error: 'missing_match_keys' });
  });

  it('records failures with the error message', async () => {
    createServiceSupabaseClientMock.mockReturnValue(buildSupabaseMock([makeRow()], captured));
    forwardToCapiMock.mockResolvedValue({ status: 'failed', eventId: 'TB-1', error: 'boom' });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body).toMatchObject({ attempted: 1, sent: 0, failed: 1, skipped: 0 });
    expect(captured.updates[0]!.payload).toMatchObject({ capi_status: 'failed', capi_error: 'boom' });
  });
});
