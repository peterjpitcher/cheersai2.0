import { NextResponse } from 'next/server';

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getRateLimitKey, isRateLimited } from '@/lib/auth/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ROUNDS = new Set([
  'group_stage',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tournamentId: string }> },
): Promise<NextResponse> {
  const { tournamentId } = await params;

  // 1. Rate limit — before any DB query
  const rateLimitKey = getRateLimitKey(request, `feed:${tournamentId}`);
  const limited = await isRateLimited({ key: rateLimitKey, maxAttempts: 60, windowMs: 60_000 });
  if (limited) {
    return errorResponse(429, 'Rate limit exceeded');
  }

  // 2. Validate UUID format
  if (!UUID_RE.test(tournamentId)) {
    return errorResponse(400, 'Invalid tournament ID format');
  }

  // 3. Validate query parameters
  const url = new URL(request.url);
  const errors: string[] = [];

  const showingParam = url.searchParams.get('showing');
  const roundParam = url.searchParams.get('round');
  const groupParam = url.searchParams.get('group');
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const confirmedParam = url.searchParams.get('confirmed');

  let showingFilter: boolean | null = true; // default: only showing fixtures
  if (showingParam !== null) {
    if (showingParam === 'true') showingFilter = true;
    else if (showingParam === 'false') showingFilter = false;
    else errors.push('showing must be "true" or "false"');
  }

  if (roundParam !== null && !VALID_ROUNDS.has(roundParam)) {
    errors.push(`round must be one of: ${[...VALID_ROUNDS].join(', ')}`);
  }

  let fromDate: Date | null = null;
  let toDate: Date | null = null;

  if (fromParam !== null) {
    fromDate = new Date(fromParam);
    if (isNaN(fromDate.getTime())) errors.push('from must be a valid ISO 8601 datetime');
  }
  if (toParam !== null) {
    toDate = new Date(toParam);
    if (isNaN(toDate.getTime())) errors.push('to must be a valid ISO 8601 datetime');
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    errors.push('from must be earlier than or equal to to');
  }

  let confirmedFilter: boolean | null = null;
  if (confirmedParam !== null) {
    if (confirmedParam === 'true') confirmedFilter = true;
    else if (confirmedParam === 'false') confirmedFilter = false;
    else errors.push('confirmed must be "true" or "false"');
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: errors },
      { status: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
    );
  }

  // 4. Look up tournament + validate API key
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return errorResponse(401, 'Missing or invalid API key');
  }

  const supabase = createServiceSupabaseClient();

  let tournament: { id: string; name: string; slug: string; status: string; feed_api_key: string | null } | null;
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, slug, status, feed_api_key')
      .eq('id', tournamentId)
      .maybeSingle();

    if (error) throw error;
    tournament = data;
  } catch {
    return errorResponse(500, 'Internal server error');
  }

  if (!tournament || !tournament.feed_api_key) {
    return errorResponse(404, 'Tournament not found');
  }

  if (tournament.feed_api_key !== apiKey) {
    return errorResponse(401, 'Missing or invalid API key');
  }

  // 5. Query fixtures with filters
  try {
    let query = supabase
      .from('tournament_fixtures')
      .select('id, match_number, round, group_name, team_a, team_b, teams_confirmed, kick_off_at, venue_city, showing, showing_note, booking_url')
      .eq('tournament_id', tournamentId)
      .order('kick_off_at', { ascending: true });

    if (showingFilter !== null) {
      query = query.eq('showing', showingFilter);
    }
    if (roundParam) {
      query = query.eq('round', roundParam);
    }
    if (groupParam) {
      query = query.eq('group_name', groupParam);
    }
    if (fromDate) {
      query = query.gte('kick_off_at', fromDate.toISOString());
    }
    if (toDate) {
      query = query.lte('kick_off_at', toDate.toISOString());
    }
    if (confirmedFilter !== null) {
      query = query.eq('teams_confirmed', confirmedFilter);
    }

    const { data: fixtures, error: fixturesError } = await query;
    if (fixturesError) throw fixturesError;

    // 6. Build curated response
    const body = {
      tournament: {
        id: tournament.id,
        name: tournament.name,
        slug: tournament.slug,
        status: tournament.status,
      },
      fixtures: (fixtures ?? []).map((f: Record<string, unknown>) => ({
        id: f.id,
        matchNumber: f.match_number,
        round: f.round,
        groupName: f.group_name ?? null,
        teamA: f.team_a,
        teamB: f.team_b,
        teamsConfirmed: f.teams_confirmed,
        kickOffAt: f.kick_off_at,
        venueCity: f.venue_city ?? null,
        showing: f.showing,
        showingNote: f.showing_note ?? null,
        bookingUrl: f.booking_url ?? null,
      })),
      meta: {
        total: (fixtures ?? []).length,
        generatedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 's-maxage=300, stale-while-revalidate=60',
        'Vary': 'x-api-key',
      },
    });
  } catch {
    return errorResponse(500, 'Internal server error');
  }
}
