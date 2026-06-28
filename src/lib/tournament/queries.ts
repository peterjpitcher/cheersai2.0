import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Tournament,
  TournamentFixture,
  TournamentWithStats,
  TournamentPlatform,
  TournamentStatus,
  TournamentRound,
  FixtureContentStatus,
} from '@/types/tournament';

// --- snake_case DB row → camelCase TypeScript mappers ---

function mapTournament(row: Record<string, unknown>): Tournament {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as TournamentStatus,
    baseImageSquareId: (row.base_image_square_id as string) ?? null,
    baseImageStoryId: (row.base_image_story_id as string) ?? null,
    houseRulesText: (row.house_rules_text as string) ?? null,
    postTemplate: row.post_template as string,
    platforms: row.platforms as TournamentPlatform[],
    postLeadHours: row.post_lead_hours as number,
    feedApiKey: (row.feed_api_key as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapFixture(row: Record<string, unknown>): TournamentFixture {
  return {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    matchNumber: row.match_number as number,
    round: row.round as TournamentRound,
    groupName: (row.group_name as string) ?? null,
    teamA: row.team_a as string,
    teamB: row.team_b as string,
    teamsConfirmed: row.teams_confirmed as boolean,
    kickOffAt: row.kick_off_at as string,
    venueCity: (row.venue_city as string) ?? null,
    showing: row.showing as boolean,
    showingNote: (row.showing_note as string) ?? null,
    bookingUrl: (row.booking_url as string) ?? null,
    contentGenerated: row.content_generated as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// --- Tournament queries ---

export async function getTournamentsByAccount(
  supabase: SupabaseClient,
  accountId: string,
): Promise<TournamentWithStats[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('account_id', accountId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const tournaments = (data ?? []).map(mapTournament);

  const stats = await Promise.all(
    tournaments.map(async (t) => {
      const { data: fixtures } = await supabase
        .from('tournament_fixtures')
        .select('showing, teams_confirmed, content_generated')
        .eq('tournament_id', t.id);

      const f = fixtures ?? [];
      return {
        ...t,
        totalFixtures: f.length,
        showingCount: f.filter((fx: Record<string, unknown>) => fx.showing).length,
        confirmedCount: f.filter((fx: Record<string, unknown>) => fx.teams_confirmed).length,
        scheduledCount: f.filter((fx: Record<string, unknown>) => fx.content_generated).length,
        publishedCount: 0,
      };
    }),
  );

  return stats;
}

export async function getTournamentById(
  supabase: SupabaseClient,
  tournamentId: string,
  accountId: string,
): Promise<Tournament | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapTournament(data) : null;
}

export async function getFixturesByTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<TournamentFixture[]> {
  const { data, error } = await supabase
    .from('tournament_fixtures')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('kick_off_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapFixture);
}

export async function getFixtureById(
  supabase: SupabaseClient,
  fixtureId: string,
  tournamentId: string,
): Promise<TournamentFixture | null> {
  const { data, error } = await supabase
    .from('tournament_fixtures')
    .select('*')
    .eq('id', fixtureId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapFixture(data) : null;
}

// --- Content lookup helpers ---

const PUBLISHED_CONTENT_STATUSES = new Set(['published', 'posted', 'succeeded']);
const PUBLISHED_JOB_STATUSES = ['published', 'succeeded'];

function isPublishedContentStatus(status: string): boolean {
  return PUBLISHED_CONTENT_STATUSES.has(status);
}

export async function getFixtureContentItems(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
): Promise<Array<{ id: string; platform: string; placement: string; status: string }>> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id, platform, placement, status')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .contains('prompt_context', { tournament_fixture_id: fixtureId, source: 'tournament' });

  if (error) throw error;

  return data ?? [];
}

export async function getPublishedPlacements(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
): Promise<Set<string>> {
  const items = await getFixtureContentItems(supabase, fixtureId, accountId);
  const published = new Set<string>();

  for (const item of items) {
    if (isPublishedContentStatus(item.status)) {
      published.add(`${item.platform}:${item.placement}`);
      continue;
    }

    const { data: jobs } = await supabase
      .from('publish_jobs')
      .select('status')
      .eq('content_item_id', item.id)
      .in('status', PUBLISHED_JOB_STATUSES)
      .limit(1);

    if (jobs?.length) {
      published.add(`${item.platform}:${item.placement}`);
    }
  }

  return published;
}

export async function deriveFixtureContentStatuses(
  supabase: SupabaseClient,
  fixtures: TournamentFixture[],
  accountId: string,
): Promise<Map<string, FixtureContentStatus>> {
  const statusMap = new Map<string, FixtureContentStatus>();

  const generatedFixtures = fixtures.filter((f) => f.contentGenerated);
  if (!generatedFixtures.length) return statusMap;

  const fixtureIds = generatedFixtures.map((f) => f.id);

  const { data: contentItems } = await supabase
    .from('content_items')
    .select('id, status, scheduled_for, prompt_context')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .contains('prompt_context', { source: 'tournament' });

  const fixtureContentMap = new Map<string, Array<{ status: string; scheduledFor: string | null }>>();
  for (const item of contentItems ?? []) {
    const ctx = item.prompt_context as Record<string, unknown> | null;
    const fId = ctx?.tournament_fixture_id as string | undefined;
    if (!fId || !fixtureIds.includes(fId)) continue;
    if (!fixtureContentMap.has(fId)) fixtureContentMap.set(fId, []);
    fixtureContentMap.get(fId)!.push({
      status: item.status as string,
      scheduledFor: item.scheduled_for as string | null,
    });
  }

  const now = Date.now();
  for (const fixture of generatedFixtures) {
    const items = fixtureContentMap.get(fixture.id) ?? [];
    if (!items.length) {
      statusMap.set(fixture.id, 'ready');
      continue;
    }

    const allPublished = items.every((i) => isPublishedContentStatus(i.status));
    if (allPublished) {
      statusMap.set(fixture.id, 'published');
      continue;
    }

    const anyPastDue = items.some(
      (i) =>
        i.scheduledFor
        && new Date(i.scheduledFor).getTime() < now
        && !isPublishedContentStatus(i.status),
    );
    if (anyPastDue) {
      statusMap.set(fixture.id, 'past_due');
      continue;
    }

    const anyBlocked = items.some((i) =>
      i.status === 'blocked'
      || i.status === 'failed'
      || i.status === 'draft'
      || i.status === 'review',
    );
    if (anyBlocked) {
      statusMap.set(fixture.id, 'blocked');
      continue;
    }

    statusMap.set(fixture.id, 'scheduled');
  }

  return statusMap;
}
