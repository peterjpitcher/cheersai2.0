import { NATIONS_TEMPLATE_VERSION, nationsContentLinks } from '../../../supabase/functions/_shared/nations-content-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTournamentContentIssue } from './content-freshness';
import { getTournamentById, getFixtureById } from './queries';
import { projectTournamentFixtures } from './screening-service';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('./queries', () => ({ getTournamentById: vi.fn(), getFixtureById: vi.fn() }));
vi.mock('./screening-service', () => ({ projectTournamentFixtures: vi.fn() }));
const db = {} as SupabaseClient;
const context = { screening_template_version: NATIONS_TEMPLATE_VERSION, ...nationsContentLinks('f1', '2026-11-07'), source: 'tournament', tournament_id: 't1', tournament_fixture_id: 'f1', screening_revision: 4, tournament_updated_at: 'revision-time', screening_hours_fingerprint: 'hours-1' };
beforeEach(() => {
  vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', accountId: 'account', sport: 'rugby_union', status: 'active', updatedAt: 'revision-time' } as Awaited<ReturnType<typeof getTournamentById>>);
  vi.mocked(getFixtureById).mockResolvedValue({ id: 'f1', contentRevision: 4, kickOffAt: '2026-11-07T12:00:00Z', bookingUrl: null } as Awaited<ReturnType<typeof getFixtureById>>);
  vi.mocked(projectTournamentFixtures).mockResolvedValue([{ screening: { canGenerateTeamPromotion: true }, hours: { fingerprint: 'hours-1' } }] as Awaited<ReturnType<typeof projectTournamentFixtures>>);
});
describe('fresh screening delivery facts', () => {
  it('allows a matching snapshot with an account-scoped tournament lookup', async () => {
    expect(await getTournamentContentIssue(db, 'account', context)).toBeNull();
    expect(getTournamentById).toHaveBeenCalledWith(db, 't1', 'account');
  });
  it.each([{ ...context, screening_revision: 3 }, { ...context, screening_hours_fingerprint: 'old' }, { ...context, tournament_updated_at: 'old' }])('blocks changed fixture, hours or tournament snapshot', async snapshot => {
    expect(await getTournamentContentIssue(db, 'account', snapshot)).toMatch(/changed/);
  });
  it('blocks newly ineligible screenings and dependency failures', async () => {
    vi.mocked(projectTournamentFixtures).mockRejectedValue(new Error('offline'));
    expect(await getTournamentContentIssue(db, 'account', context)).toContain('could not be verified');
  });
  it('preserves old football semantics', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ sport: 'football' } as Awaited<ReturnType<typeof getTournamentById>>);
    expect(await getTournamentContentIssue(db, 'account', context)).toBeNull();
  });
});

it.each([
  { screening_template_version: undefined }, { screening_template_version: 'old' },
  { ctaUrl: 'https://unapproved.example/checkout' }, { linkInBioUrl: 'javascript:alert(1)' },
  { booking_url: 'https://www.the-anchor.pub/book-table?fixture_id=other' },
])('blocks an unapproved content contract before projecting hours: %j', async change => {
  vi.mocked(projectTournamentFixtures).mockClear();
  expect(await getTournamentContentIssue(db, 'account', { ...context, ...change })).toMatch(/template|destination/);
  expect(projectTournamentFixtures).not.toHaveBeenCalled();
});
