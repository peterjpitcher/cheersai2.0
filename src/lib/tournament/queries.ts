import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Tournament,
  TournamentFixture,
  TournamentWithStats,
  TournamentPlatform,
  TournamentStatus,
  TournamentRound,
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

export async function getFixtureContentItems(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
): Promise<Array<{ id: string; platform: string; placement: string; status: string }>> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id, platform, placement, status')
    .eq('account_id', accountId)
    .containedBy('prompt_context', { tournament_fixture_id: fixtureId, source: 'tournament' });

  if (error) {
    // containedBy may not work for subfield JSONB matching on all Supabase versions;
    // fall back to client-side filter over all account items.
    const { data: allItems, error: fallbackError } = await supabase
      .from('content_items')
      .select('id, platform, placement, status, prompt_context')
      .eq('account_id', accountId);

    if (fallbackError) throw fallbackError;

    return (allItems ?? []).filter(
      (item: Record<string, unknown>) => {
        const ctx = item.prompt_context as Record<string, unknown> | null;
        return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
      },
    );
  }

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
    const { data: jobs } = await supabase
      .from('publish_jobs')
      .select('status')
      .eq('content_item_id', item.id)
      .eq('status', 'succeeded')
      .limit(1);

    if (jobs?.length) {
      published.add(`${item.platform}:${item.placement}`);
    }
  }

  return published;
}
