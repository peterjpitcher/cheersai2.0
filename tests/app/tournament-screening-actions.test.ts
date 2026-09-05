import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tournament, TournamentFixture } from '@/types/tournament';
import { prepareRugbyFixture, saveRugbyFixture } from '@/lib/tournament/screening-mutation';
import { projectTournamentFixtures } from '@/lib/tournament/screening-service';
import { getFixturesByTournament } from '@/lib/tournament/queries';
import { invalidateFixtureContent } from '@/lib/tournament/content-freshness';
vi.mock('@/lib/tournament/screening-service', () => ({ projectTournamentFixtures: vi.fn() }));
vi.mock('@/lib/tournament/queries', () => ({ getFixturesByTournament: vi.fn() }));
vi.mock('@/lib/tournament/content-freshness', () => ({ invalidateFixtureContent: vi.fn() }));
const tournament = { id: 't', accountId: 'a', sport: 'rugby_union' } as Tournament;
const fixture = { id: 'f', teamsConfirmed: true, teamA: 'England', teamB: 'Japan', kickOffAt: '2026-11-14T16:40:00Z', plannedEndAt: '2026-11-14T18:40:00Z', screeningDecision: 'confirmed', screenLabel: 'Main', commentary: 'on', contentRevision: 1 } as TournamentFixture;
const update = vi.fn();
const eq = vi.fn();
let saved = true;
const db = { from: () => { const chain = { update: (payload: unknown) => { update(payload); return chain; }, eq: (...args: unknown[]) => { eq(...args); return chain; }, select: () => chain, maybeSingle: async () => ({ data: saved ? { id: 'f' } : null, error: null }) }; return chain; } } as unknown as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks(); saved = true;
  vi.mocked(projectTournamentFixtures).mockResolvedValue([{ screening: { status: 'confirmed_partial', canBookForScreening: true } }] as Awaited<ReturnType<typeof projectTournamentFixtures>>);
  vi.mocked(getFixturesByTournament).mockResolvedValue([]);
  vi.mocked(invalidateFixtureContent).mockResolvedValue(undefined);
});
describe('shared rugby mutations', () => {
  it('derives showing for partial screenings and increments the optimistic revision', async () => {
    await saveRugbyFixture(db, tournament, fixture, fixture, {}, 1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ showing: true, content_revision: 2, content_generated: false }));
    expect(eq).toHaveBeenCalledWith('tournament_id', 't');
    expect(eq).toHaveBeenCalledWith('content_revision', 1);
    expect(invalidateFixtureContent).toHaveBeenCalledWith(db, 'a', 'f');
  });
  it('rejects stale edits before writing', async () => {
    await expect(saveRugbyFixture(db, tournament, fixture, fixture, {}, 0)).rejects.toThrow('changed');
    expect(update).not.toHaveBeenCalled();
  });
  it('reports a cancellation failure honestly after revision changed', async () => {
    vi.mocked(invalidateFixtureContent).mockRejectedValue(new Error('database unavailable'));
    await expect(saveRugbyFixture(db, tournament, fixture, fixture, {}, 1)).rejects.toThrow('Fixture saved, but pending posts');
  });
  it('rejects overlapping commentary and screen allocations', async () => {
    vi.mocked(getFixturesByTournament).mockResolvedValue([{ ...fixture, id: 'other' }]);
    await expect(prepareRugbyFixture(db, tournament, fixture)).rejects.toThrow('screen already');
    vi.mocked(getFixturesByTournament).mockResolvedValue([{ ...fixture, id: 'other', screenLabel: 'Other' }]);
    await expect(prepareRugbyFixture(db, tournament, fixture)).rejects.toThrow('commentary');
  });
  it('does not confirm when hours fail closed', async () => {
    vi.mocked(projectTournamentFixtures).mockResolvedValue([{ screening: { status: 'hours_unknown', canBookForScreening: false } }] as Awaited<ReturnType<typeof projectTournamentFixtures>>);
    await expect(prepareRugbyFixture(db, tournament, fixture)).rejects.toThrow('hours_unknown');
  });
  it('allows marking a previously confirmed screening finished without re-confirming future hours', async () => {
    vi.mocked(projectTournamentFixtures).mockResolvedValue([{ screening: { status: 'finished', canBookForScreening: false } }] as Awaited<ReturnType<typeof projectTournamentFixtures>>);
    expect(await prepareRugbyFixture(db, tournament, { ...fixture, matchState: 'finished' })).toMatchObject({ showing: false, match_state: 'finished' });
  });

  it('allows reusing a screen released by a cancelled fixture', async () => {
    vi.mocked(getFixturesByTournament).mockResolvedValue([{ ...fixture, id: 'cancelled', matchState: 'cancelled' }]);
    expect(await prepareRugbyFixture(db, tournament, fixture)).toMatchObject({ showing: true });
  });

});
