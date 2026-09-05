import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tournament, TournamentFixture, FixtureScreeningFields } from '@/types/tournament';
import { getFixturesByTournament } from './queries';
import { projectTournamentFixtures } from './screening-service';
import { invalidateFixtureContent } from './content-freshness';
import { areBothTeamsConfirmed } from './placeholder';

export async function prepareRugbyFixture(db: SupabaseClient, tournament: Tournament, candidate: TournamentFixture): Promise<Record<string, unknown>> {
  if (candidate.teamsConfirmed && !areBothTeamsConfirmed(candidate.teamA, candidate.teamB)) throw new Error('Final opponents must be verified before confirming teams.');
  const [projected] = await projectTournamentFixtures(db, tournament, [candidate]);
  if (candidate.screeningDecision === 'confirmed' && candidate.matchState !== 'finished' && candidate.matchState !== 'cancelled') {
    if (!projected.screening.canBookForScreening) throw new Error(`Cannot confirm this screening: ${projected.screening.status}. Check channel, verification, screen allocation, planned end and existing opening hours.`);
    const others = await getFixturesByTournament(db, tournament.id);
    const collision = others.some(other => other.id !== candidate.id && other.matchState !== 'finished' && other.matchState !== 'cancelled' && other.screeningDecision === 'confirmed' && other.screenLabel?.trim().toLowerCase() === candidate.screenLabel?.trim().toLowerCase() && Date.parse(other.kickOffAt) < Date.parse(candidate.plannedEndAt!) && Date.parse(other.plannedEndAt ?? '') > Date.parse(candidate.kickOffAt));
    if (collision) throw new Error('This screen already has a confirmed overlapping game. Allocate another screen after checking receiver capacity.');
    const commentaryCollision = candidate.commentary === 'on' && others.some(other => other.id !== candidate.id && other.matchState !== 'finished' && other.matchState !== 'cancelled' && other.screeningDecision === 'confirmed' && other.commentary === 'on' && Date.parse(other.kickOffAt) < Date.parse(candidate.plannedEndAt!) && Date.parse(other.plannedEndAt ?? '') > Date.parse(candidate.kickOffAt));
    if (commentaryCollision) throw new Error('Another overlapping game already has commentary. Confirm the audio allocation first.');
  }
  const fields: Array<keyof FixtureScreeningFields> = ['importKey','roundNumber','finalPosition','plannedEndAt','matchState','screeningDecision','broadcastDecision','linearChannel','screenLabel','commentary','sourceUrl','sourceCheckedAt','broadcastCheckedAt','screeningConfirmedAt'];
  const payload: Record<string, unknown> = { showing: projected.screening.canBookForScreening, teams_confirmed: candidate.teamsConfirmed };
  for (const field of fields) if (candidate[field] !== undefined) payload[field.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`)] = candidate[field];
  return payload;
}

export async function saveRugbyFixture(db: SupabaseClient, tournament: Tournament, old: TournamentFixture, candidate: TournamentFixture, base: Record<string, unknown>, expectedRevision?: number): Promise<void> {
  if (expectedRevision !== undefined && expectedRevision !== old.contentRevision) throw new Error('This fixture changed while you were editing. Reload before saving.');
  const payload = await prepareRugbyFixture(db, tournament, candidate);
  const { data, error } = await db.from('tournament_fixtures').update({ ...base, ...payload, content_revision: (old.contentRevision ?? 1) + 1, content_generated: false }).eq('id', old.id).eq('tournament_id', tournament.id).eq('content_revision', old.contentRevision ?? 1).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This fixture changed while saving. Reload before saving.');
  try { await invalidateFixtureContent(db, tournament.accountId, old.id); }
  catch { throw new Error('Fixture saved, but pending posts could not be marked for review. Delivery is blocked by the changed revision. Reload and review pending posts.'); }
}
