import { nationsContentContractIssue } from '../_shared/nations-content-contract.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Last delivery gate. A provider request already in flight cannot be recalled. */
export async function legacyTournamentContentIssue(db: SupabaseClient, accountId: string, context: Record<string, unknown> | null): Promise<string | null> {
  if (context?.source !== 'tournament') return null;
  try {
    const { data: tournament, error: tournamentError } = await db.from('tournaments').select('id, sport, status, updated_at').eq('id', context.tournament_id).eq('account_id', accountId).maybeSingle();
    if (tournamentError || !tournament) return 'Tournament unavailable. Review required.';
    if (tournament.sport !== 'rugby_union') return null;
    if (tournament.status !== 'active' || tournament.updated_at !== context.tournament_updated_at) return 'Tournament changed. Review and regenerate.';
    const { data: fixture, error: fixtureError } = await db.from('tournament_fixtures').select('content_revision, screening_decision, broadcast_decision, teams_confirmed, planned_end_at, kick_off_at, match_state, booking_url').eq('id', context.tournament_fixture_id).eq('tournament_id', tournament.id).maybeSingle();
    if (fixtureError || !fixture || fixture.content_revision !== context.screening_revision || fixture.screening_decision !== 'confirmed' || fixture.broadcast_decision !== 'confirmed' || !fixture.teams_confirmed || !['scheduled','in_progress'].includes(fixture.match_state) || !(Date.parse(fixture.planned_end_at) > Date.now())) return 'Screening changed or ended. Review and regenerate.';
    const { data: connection, error: connectionError } = await db.from('management_app_connections').select('base_url, api_key, enabled').eq('account_id', accountId).maybeSingle();
    if (connectionError || !connection?.enabled || !connection.api_key) return 'Opening and kitchen times unavailable. Review required.';
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(fixture.kick_off_at));
    const contractIssue = nationsContentContractIssue(context, String(context.tournament_fixture_id), date, fixture.booking_url);
    if (contractIssue) return contractIssue;
    const url = new URL('/api/business/screening-hours', connection.base_url);
    if (url.protocol !== 'https:') return 'Management connection invalid. Review required.';
    url.searchParams.set('dates', date);
    const response = await fetch(url, { headers: { 'X-API-Key': connection.api_key }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return 'Opening and kitchen times unavailable. Review required.';
    const payload = await response.json();
    const days = payload?.data?.days;
    if (payload?.success !== true || payload?.data?.schemaVersion !== 1 || payload?.data?.timezone !== 'Europe/London' || !Array.isArray(days) || days.length !== 1 || days[0].date !== date || days[0].state !== 'open' || !context.screening_hours_fingerprint || days[0].fingerprint !== context.screening_hours_fingerprint) return 'Opening or kitchen times changed. Review and regenerate.';
    return null;
  } catch { return 'Screening facts unavailable. Review required.'; }
}
