import { DateTime } from 'luxon';
import { nationsContentContractIssue } from '../../../supabase/functions/_shared/nations-content-contract';
import { coveredFixtureIds, expectedFixtureRevision } from '../../../supabase/functions/_shared/tournament-roundup';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTournamentById, getFixtureById } from './queries';
import { projectTournamentFixtures } from './screening-service';
import type { TournamentFixture } from '@/types/tournament';

/**
 * Why a tournament post may not go out as written, or null when it may. A
 * match-day round-up passes only when every game it covers still passes.
 */
export async function getTournamentContentIssue(db: SupabaseClient, accountId: string, context: Record<string, unknown> | null): Promise<string | null> {
  if (context?.source !== 'tournament') return null;
  try {
    const tournamentId = typeof context.tournament_id === 'string' ? context.tournament_id : '';
    const tournament = await getTournamentById(db, tournamentId, accountId);
    if (!tournament) return 'Tournament unavailable. Review required.';
    if (tournament.sport !== 'rugby_union') return null;
    if (tournament.status !== 'active') return 'Tournament is inactive. Review required.';
    const fixtureIds = coveredFixtureIds(context);
    if (!fixtureIds.length || tournament.updatedAt !== context.tournament_updated_at) return 'Screening facts changed. Review and regenerate this post.';
    const fixtures: TournamentFixture[] = [];
    for (const fixtureId of fixtureIds) {
      const fixture = await getFixtureById(db, fixtureId, tournament.id);
      if (!fixture || fixture.contentRevision !== expectedFixtureRevision(context, fixtureId)) return 'Screening facts changed. Review and regenerate this post.';
      fixtures.push(fixture);
    }
    const lead = fixtures[0];
    const contractIssue = nationsContentContractIssue(context, lead.id, DateTime.fromISO(lead.kickOffAt, { zone: 'Europe/London' }).toISODate() ?? '', lead.bookingUrl);
    if (contractIssue) return contractIssue;
    const current = await projectTournamentFixtures(db, tournament, fixtures);
    if (current.some(game => !game.screening.canGenerateTeamPromotion)) return 'Screening is no longer eligible for promotion. Review required.';
    if (current.some(game => game.hours.fingerprint !== context.screening_hours_fingerprint)) return 'Opening or kitchen times changed. Review and regenerate this post.';
    return null;
  } catch { return 'Screening facts could not be verified. Review required.'; }
}

export async function checkTournamentContentById(db: SupabaseClient, accountId: string, contentId: string): Promise<string | null> {
  try {
    const { data, error } = await db.from('content_items').select('prompt_context').eq('id', contentId).eq('account_id', accountId).maybeSingle();
    if (error || !data) return 'Content could not be verified. Review required.';
    return getTournamentContentIssue(db, accountId, data.prompt_context);
  } catch { return 'Content could not be verified. Review required.'; }
}

/**
 * Tournament posts that cover a fixture: its own posts and any match-day
 * round-up that lists it. Binned posts are left out unless includeDeleted is
 * set, which the delete path uses so a regeneration also clears the bin, as
 * it always has.
 */
export async function findContentCoveringFixture(
  db: SupabaseClient,
  accountId: string,
  fixtureId: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<Array<{ id: string; status: string; platform: string | null; placement: string | null; scheduled_for: string | null; prompt_context: Record<string, unknown> | null }>> {
  const columns = 'id, status, platform, placement, scheduled_for, prompt_context';
  const lookup = (containing: Record<string, unknown>) => {
    const query = db.from('content_items').select(columns).eq('account_id', accountId);
    return (includeDeleted ? query : query.is('deleted_at', null)).contains('prompt_context', containing);
  };
  const [own, roundups] = await Promise.all([
    lookup({ source: 'tournament', tournament_fixture_id: fixtureId }),
    lookup({ source: 'tournament', roundup_fixture_ids: [fixtureId] }),
  ]);
  if (own.error) throw own.error;
  if (roundups.error) throw roundups.error;
  const byId = new Map<string, { id: string; status: string; platform: string | null; placement: string | null; scheduled_for: string | null; prompt_context: Record<string, unknown> | null }>();
  for (const item of [...(own.data ?? []), ...(roundups.data ?? [])]) byId.set(item.id as string, item as never);
  return [...byId.values()];
}

/** Revision is written first. Delivery checks block stale content even if cancellation fails. */
export async function invalidateFixtureContent(db: SupabaseClient, accountId: string, fixtureId: string): Promise<void> {
  const items = await findContentCoveringFixture(db, accountId, fixtureId);
  const ids = items.filter(item => !['published','posted','succeeded','publishing','in_progress'].includes(item.status)).map(item => item.id);
  if (!ids.length) return;
  const { error: contentError } = await db.from('content_items').update({ status: 'draft' }).eq('account_id', accountId).in('id', ids);
  if (contentError) throw contentError;
  const { error: jobsError } = await db.from('publish_jobs').update({ status: 'failed', error_message: 'Screening changed. Review and regenerate.', last_error: 'Screening changed. Review and regenerate.', error_code: 'SCREENING_REVIEW_REQUIRED', next_attempt_at: null }).eq('account_id', accountId).in('content_item_id', ids).in('status', ['scheduled','queued','pending','failed']);
  if (jobsError) throw jobsError;
}
