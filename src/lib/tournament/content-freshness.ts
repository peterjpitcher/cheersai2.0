import { DateTime } from 'luxon';
import { nationsContentContractIssue } from '../../../supabase/functions/_shared/nations-content-contract';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTournamentById, getFixtureById } from './queries';
import { projectTournamentFixtures } from './screening-service';

export async function getTournamentContentIssue(db: SupabaseClient, accountId: string, context: Record<string, unknown> | null): Promise<string | null> {
  if (context?.source !== 'tournament') return null;
  try {
    const tournamentId = typeof context.tournament_id === 'string' ? context.tournament_id : '';
    const tournament = await getTournamentById(db, tournamentId, accountId);
    if (!tournament) return 'Tournament unavailable. Review required.';
    if (tournament.sport !== 'rugby_union') return null;
    if (tournament.status !== 'active') return 'Tournament is inactive. Review required.';
    const fixture = await getFixtureById(db, String(context.tournament_fixture_id ?? ''), tournament.id);
    if (!fixture || fixture.contentRevision !== context.screening_revision || tournament.updatedAt !== context.tournament_updated_at) return 'Screening facts changed. Review and regenerate this post.';
    const contractIssue = nationsContentContractIssue(context, fixture.id, DateTime.fromISO(fixture.kickOffAt, { zone: 'Europe/London' }).toISODate() ?? '', fixture.bookingUrl);
    if (contractIssue) return contractIssue;
    const [current] = await projectTournamentFixtures(db, tournament, [fixture]);
    if (!current.screening.canGenerateTeamPromotion) return 'Screening is no longer eligible for promotion. Review required.';
    if (current.hours.fingerprint !== context.screening_hours_fingerprint) return 'Opening or kitchen times changed. Review and regenerate this post.';
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

/** Revision is written first. Delivery checks block stale content even if cancellation fails. */
export async function invalidateFixtureContent(db: SupabaseClient, accountId: string, fixtureId: string): Promise<void> {
  const { data, error } = await db.from('content_items').select('id, status').eq('account_id', accountId).contains('prompt_context', { source: 'tournament', tournament_fixture_id: fixtureId }).is('deleted_at', null);
  if (error) throw error;
  const ids = (data ?? []).filter(item => !['published','posted','succeeded','publishing','in_progress'].includes(item.status)).map(item => item.id);
  if (!ids.length) return;
  const { error: contentError } = await db.from('content_items').update({ status: 'draft' }).eq('account_id', accountId).in('id', ids);
  if (contentError) throw contentError;
  const { error: jobsError } = await db.from('publish_jobs').update({ status: 'failed', error_message: 'Screening changed. Review and regenerate.', last_error: 'Screening changed. Review and regenerate.', error_code: 'SCREENING_REVIEW_REQUIRED', next_attempt_at: null }).eq('account_id', accountId).in('content_item_id', ids).in('status', ['scheduled','queued','pending','failed']);
  if (jobsError) throw jobsError;
}
