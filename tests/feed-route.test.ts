/**
 * Unit tests for the tournament fixture feed API route.
 * Route: src/app/api/feed/[tournamentId]/route.ts
 *
 * The Supabase mock uses a call-count strategy: the first `.from()` call (tournaments
 * lookup) returns tournament data, the second `.from()` call (fixtures query) returns
 * fixture data. Each test seeds `mockFromResults` with two entries before importing/calling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Types for mock internals
// ---------------------------------------------------------------------------
interface MockResult {
  data: unknown;
  error: unknown;
}

// ---------------------------------------------------------------------------
// Supabase mock — fluent builder, results driven by mockFromResults queue
// ---------------------------------------------------------------------------
let mockFromResults: MockResult[] = [];
let fromCallCount = 0;

function createBuilder(result: MockResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    order: vi.fn(chain),
    gte: vi.fn(chain),
    lte: vi.fn(chain),
    maybeSingle: vi.fn(async () => result),
    // For fixture queries that don't end with maybeSingle, the awaited value
    // is the result itself (Supabase returns the promise directly from the builder).
    then: (resolve: (v: MockResult) => void) => Promise.resolve(result).then(resolve),
  });
  return builder;
}

const mockFrom = vi.fn(() => {
  const result = mockFromResults[fromCallCount] ?? { data: null, error: null };
  fromCallCount += 1;
  return createBuilder(result);
});

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({ from: mockFrom }),
}));

import { isRateLimited } from '@/lib/auth/rate-limit';

vi.mock('@/lib/auth/rate-limit', () => ({
  getRateLimitKey: (_req: Request, prefix: string) => `test:${prefix}`,
  isRateLimited: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Import route AFTER mocks are registered
// ---------------------------------------------------------------------------
import { GET, OPTIONS } from '@/app/api/feed/[tournamentId]/route';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const VALID_UUID = 'f40ef35f-5a1c-4409-8d02-27f2f97d0a0e';
const VALID_KEY = 'abc123def456abc123def456abc123de';

const TOURNAMENT_ROW = {
  id: VALID_UUID,
  name: 'Test Cup',
  slug: 'test-cup',
  status: 'active',
  feed_api_key: VALID_KEY,
};

const FIXTURE_ROWS = [
  {
    id: 'fix-1',
    match_number: 1,
    round: 'group_stage',
    group_name: 'Group A',
    team_a: 'Team One',
    team_b: 'Team Two',
    teams_confirmed: true,
    kick_off_at: '2026-06-11T19:00:00Z',
    venue_city: 'London',
    showing: true,
    showing_note: null,
    booking_url: 'https://example.com/book',
  },
];

// ---------------------------------------------------------------------------
// Helper — build a Request + params tuple
// ---------------------------------------------------------------------------
function makeRequest(
  tournamentId: string,
  opts: { apiKey?: string; query?: string } = {},
): [Request, { params: Promise<{ tournamentId: string }> }] {
  const url = `http://localhost/api/feed/${tournamentId}${opts.query ?? ''}`;
  const headers = new Headers();
  if (opts.apiKey) headers.set('x-api-key', opts.apiKey);
  return [
    new Request(url, { headers }),
    { params: Promise.resolve({ tournamentId }) },
  ];
}

/** Seed mock results and reset call counter. */
function seedMocks(tournamentResult: MockResult, fixtureResult?: MockResult): void {
  fromCallCount = 0;
  mockFromResults = fixtureResult
    ? [tournamentResult, fixtureResult]
    : [tournamentResult];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('OPTIONS /api/feed/[tournamentId]', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

describe('GET /api/feed/[tournamentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallCount = 0;
    mockFromResults = [];
    // Default: not rate limited
    vi.mocked(isRateLimited).mockResolvedValue(false);
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rate limited, before any DB query', async () => {
      vi.mocked(isRateLimited).mockResolvedValue(true);
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(429);
      // No DB calls should have been made
      expect(mockFrom).not.toHaveBeenCalled();
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/rate limit/i);
    });
  });

  // -------------------------------------------------------------------------
  // UUID validation
  // -------------------------------------------------------------------------
  describe('UUID validation', () => {
    it('returns 400 for a non-UUID tournament ID', async () => {
      const [req, ctx] = makeRequest('not-a-uuid', { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/invalid tournament id/i);
    });

    it('returns 400 for a short hex string that is not a UUID', async () => {
      const [req, ctx] = makeRequest('f40ef35f-5a1c', { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Query parameter validation
  // -------------------------------------------------------------------------
  describe('query parameter validation', () => {
    it('returns 400 for invalid "showing" value', async () => {
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?showing=maybe' });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      const body = await res.json() as { details: string[] };
      expect(body.details.some((d: string) => /showing/i.test(d))).toBe(true);
    });

    it('returns 400 for an invalid round value', async () => {
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?round=banana' });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      const body = await res.json() as { details: string[] };
      expect(body.details.some((d: string) => /round/i.test(d))).toBe(true);
    });

    it('returns 400 for a malformed "from" date', async () => {
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?from=not-a-date' });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      const body = await res.json() as { details: string[] };
      expect(body.details.some((d: string) => /from/i.test(d))).toBe(true);
    });

    it('returns 400 for a malformed "to" date', async () => {
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?to=not-a-date' });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      const body = await res.json() as { details: string[] };
      expect(body.details.some((d: string) => /to/i.test(d))).toBe(true);
    });

    it('returns 400 when "from" is after "to"', async () => {
      const [req, ctx] = makeRequest(VALID_UUID, {
        apiKey: VALID_KEY,
        query: '?from=2026-07-01&to=2026-06-01',
      });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      const body = await res.json() as { details: string[] };
      expect(body.details.some((d: string) => /from.*to|to.*from|range/i.test(d))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // API key checks
  // -------------------------------------------------------------------------
  describe('API key authentication', () => {
    it('returns 401 when no x-api-key header is provided', async () => {
      // No API key — should fail before DB lookup
      const [req, ctx] = makeRequest(VALID_UUID);
      const res = await GET(req, ctx);
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/missing|invalid|api key/i);
    });

    it('returns 401 when wrong API key is provided', async () => {
      seedMocks(
        { data: TOURNAMENT_ROW, error: null },
        { data: FIXTURE_ROWS, error: null },
      );
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: 'wrong-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
      const res = await GET(req, ctx);
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/missing|invalid|api key/i);
    });
  });

  // -------------------------------------------------------------------------
  // Tournament not found / feed disabled
  // -------------------------------------------------------------------------
  describe('tournament existence', () => {
    it('returns 404 when tournament is not found (null data)', async () => {
      seedMocks({ data: null, error: null });
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it('returns 404 when feed_api_key is NULL (feed disabled)', async () => {
      seedMocks({ data: { ...TOURNAMENT_ROW, feed_api_key: null }, error: null });
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Successful 200 response
  // -------------------------------------------------------------------------
  describe('successful fixture feed response', () => {
    it('returns 200 with correctly shaped response body', async () => {
      seedMocks(
        { data: TOURNAMENT_ROW, error: null },
        { data: FIXTURE_ROWS, error: null },
      );
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);

      const body = await res.json() as {
        tournament: { id: string; name: string; slug: string; status: string };
        fixtures: Array<Record<string, unknown>>;
        meta: { total: number; generatedAt: string };
      };

      // Tournament shape
      expect(body.tournament.id).toBe(VALID_UUID);
      expect(body.tournament.name).toBe('Test Cup');
      expect(body.tournament.slug).toBe('test-cup');
      expect(body.tournament.status).toBe('active');

      // Fixtures — camelCase field names
      expect(body.fixtures).toHaveLength(1);
      const fixture = body.fixtures[0];
      expect(fixture.id).toBe('fix-1');
      expect(fixture.matchNumber).toBe(1);          // snake_case → camelCase
      expect(fixture.round).toBe('group_stage');
      expect(fixture.groupName).toBe('Group A');     // snake_case → camelCase
      expect(fixture.teamA).toBe('Team One');         // snake_case → camelCase
      expect(fixture.teamB).toBe('Team Two');         // snake_case → camelCase
      expect(fixture.teamsConfirmed).toBe(true);      // snake_case → camelCase
      expect(fixture.kickOffAt).toBe('2026-06-11T19:00:00Z'); // snake_case → camelCase
      expect(fixture.venueCity).toBe('London');       // snake_case → camelCase
      expect(fixture.showing).toBe(true);
      expect(fixture.showingNote).toBeNull();         // snake_case → camelCase
      expect(fixture.bookingUrl).toBe('https://example.com/book'); // snake_case → camelCase

      // Meta
      expect(body.meta.total).toBe(1);
      expect(typeof body.meta.generatedAt).toBe('string');
    });

    it('returns meta.total = 0 for empty fixtures', async () => {
      seedMocks(
        { data: TOURNAMENT_ROW, error: null },
        { data: [], error: null },
      );
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const body = await res.json() as { meta: { total: number }; fixtures: unknown[] };
      expect(body.meta.total).toBe(0);
      expect(body.fixtures).toHaveLength(0);
    });

    it('accepts showing=false and passes through to the fixture query', async () => {
      seedMocks(
        { data: TOURNAMENT_ROW, error: null },
        { data: [], error: null },
      );
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?showing=false' });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    });

    it('accepts showing=all and returns fixtures regardless of showing status', async () => {
      seedMocks(
        { data: TOURNAMENT_ROW, error: null },
        { data: FIXTURE_ROWS, error: null },
      );
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?showing=all' });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    });

    it('accepts a valid round filter', async () => {
      seedMocks(
        { data: TOURNAMENT_ROW, error: null },
        { data: FIXTURE_ROWS, error: null },
      );
      const [req, ctx] = makeRequest(VALID_UUID, {
        apiKey: VALID_KEY,
        query: '?round=group_stage',
      });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // CORS headers
  // -------------------------------------------------------------------------
  describe('CORS headers', () => {
    it('includes CORS headers on a 200 response', async () => {
      seedMocks(
        { data: TOURNAMENT_ROW, error: null },
        { data: FIXTURE_ROWS, error: null },
      );
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('includes CORS headers on a 400 error response', async () => {
      const [req, ctx] = makeRequest('not-a-uuid', { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('includes CORS headers on a 401 error response', async () => {
      const [req, ctx] = makeRequest(VALID_UUID);
      const res = await GET(req, ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('includes CORS headers on a 429 response', async () => {
      vi.mocked(isRateLimited).mockResolvedValue(true);
      const [req, ctx] = makeRequest(VALID_UUID, { apiKey: VALID_KEY });
      const res = await GET(req, ctx);
      expect(res.status).toBe(429);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});
