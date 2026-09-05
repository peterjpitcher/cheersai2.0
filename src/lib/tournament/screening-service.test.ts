import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tournament, TournamentFixture } from '@/types/tournament';
import { fetchScreeningHours } from '@/lib/management-app/screening-hours';
import { projectTournamentFixtures } from './screening-service';
vi.mock('@/lib/management-app/screening-hours', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/management-app/screening-hours')>(), fetchScreeningHours: vi.fn() }));
const eq = vi.fn();
const db = { from: () => { const chain = { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain; }, maybeSingle: async () => ({ data: { enabled: true, base_url: 'https://management.example.test', api_key: 'test-key' }, error: null }) }; return chain; } } as unknown as SupabaseClient;
const tournament = { id: 't', accountId: 'a', sport: 'rugby_union' } as Tournament;
const fixture = { id: 'f', showing: true, teamA: 'England', teamB: 'Japan', teamsConfirmed: true, kickOffAt: '2026-11-07T11:40:00Z', broadcastDecision: 'confirmed', broadcastCheckedAt: '2026-09-05T09:00:00Z', screeningConfirmedAt: '2026-09-05T09:00:00Z' } as TournamentFixture;
beforeEach(() => vi.clearAllMocks());
describe('approved screening projection', () => {
  it.each([
    ['11:40', '22:00', 'from_opening'],
    ['20:10', '22:00', 'until_closing'],
    ['11:40', '13:00', 'from_opening_until_closing'],
    ['14:10', '22:00', 'full'],
  ])('projects %s kick-off and %s closing as %s', async (kick, close, coverage) => {
    vi.mocked(fetchScreeningHours).mockResolvedValue({ schemaVersion: 1, timezone: 'Europe/London', days: [{ date: '2026-11-07', state: 'open', regularOpensAt: '2026-11-07T12:00:00Z', bar: { startAt: '2026-11-07T12:00:00Z', endAt: `2026-11-07T${close}:00Z` }, kitchen: [], kitchenState: 'known', hasSpecialHours: false, fingerprint: 'fp' }] });
    const [result] = await projectTournamentFixtures(db, tournament, [{ ...fixture, kickOffAt: `2026-11-07T${kick}:00Z` }], new Date('2026-09-05T09:00:00Z'));
    expect(result.coverage).toBe(coverage);
    expect(result.bookingApproved).toBe(true);
    expect(result.plannedEndAt).toBeNull();
    expect(result.screening.canBookForScreening).toBe(true);
    expect(eq).toHaveBeenCalledWith('account_id', 'a');
  });
  it('retains saved approval while blocking bookings during a management outage', async () => {
    vi.mocked(fetchScreeningHours).mockRejectedValue(new Error('offline'));
    const [result] = await projectTournamentFixtures(db, tournament, [fixture], new Date('2026-09-05T09:00:00Z'));
    expect(result.bookingApproved).toBe(true);
    expect(result.screening.status).toBe('hours_unknown');
    expect(result.screening.canBookForScreening).toBe(false);
  });
});


it('applies the owner late-finish policy only to The Anchor, retaining normal booking windows', async () => {
  vi.mocked(fetchScreeningHours).mockResolvedValue({ schemaVersion: 1, timezone: 'Europe/London', days: [{ date: '2026-11-07', state: 'open', regularOpensAt: '2026-11-07T12:00:00Z', bar: { startAt: '2026-11-07T12:00:00Z', endAt: '2026-11-07T22:00:00Z' }, kitchen: [], kitchenState: 'known', hasSpecialHours: false, fingerprint: 'fp' }] });
  const lateGame = { ...fixture, kickOffAt: '2026-11-07T20:10:00Z' };
  const reference = new Date('2026-09-05T09:00:00Z');
  const [anchor] = await projectTournamentFixtures(db, { ...tournament, accountId: '91fda684-2801-4abb-980e-f42cec017cef' }, [lateGame], reference);
  const [other] = await projectTournamentFixtures(db, tournament, [lateGame], reference);
  expect(anchor.screening.lateFinishPolicy).toBe('stay_open_if_viewers');
  expect(anchor.coverage).toBe('until_closing');
  expect(anchor.screening.screeningEndAt).toBe(other.screening.screeningEndAt);
  expect(other.screening.lateFinishPolicy).toBeUndefined();
  expect(other.screening.openingLabel).toContain('end of the match may be missed');
});
