import { NATIONS_TEMPLATE_VERSION, nationsContentLinks } from '../../../supabase/functions/_shared/nations-content-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyTournamentContentIssue } from '../../../supabase/functions/publish-queue/tournament-freshness';
import type { SupabaseClient } from '@supabase/supabase-js';
const ctx = { screening_template_version: NATIONS_TEMPLATE_VERSION, ...nationsContentLinks('f', '2026-11-07'), source: 'tournament', tournament_id: 't', tournament_fixture_id: 'f', tournament_updated_at: 'updated', screening_revision: 3, screening_hours_fingerprint: 'fp' };
function database(revision = 3, changes: Record<string, unknown> = {}): SupabaseClient {
  const rows: Record<string, unknown> = {
    tournaments: { id: 't', sport: 'rugby_union', status: 'active', updated_at: 'updated' },
    tournament_fixtures: { content_revision: revision, screening_decision: 'confirmed', broadcast_decision: 'confirmed', teams_confirmed: true, planned_end_at: '2026-11-07T14:00:00Z', kick_off_at: '2026-11-07T12:00:00Z', match_state: 'scheduled', broadcast_checked_at: '2026-09-05T09:00:00Z', screening_confirmed_at: '2026-09-05T09:00:00Z', ...changes },
    management_app_connections: { base_url: 'https://management.example.test', api_key: 'test-key', enabled: true },
  };
  return { from: (table: string) => { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: rows[table], error: null }) }; return chain; } } as unknown as SupabaseClient;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('legacy screening delivery gate', () => {
  it('allows only unchanged current hours', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    const fetch = vi.fn().mockImplementation(async () => Response.json({ success: true, data: { schemaVersion: 1, timezone: 'Europe/London', days: [{ date: '2026-11-07', state: 'open', fingerprint: 'fp', bar: { startAt: '2026-11-07T12:00:00Z', endAt: '2026-11-07T22:00:00Z' } }] } }));
    vi.stubGlobal('fetch', fetch);
    expect(await legacyTournamentContentIssue(database(), 'a', ctx)).toBeNull();
    expect(String(fetch.mock.calls[0][0])).toContain('dates=2026-11-07');
    expect(await legacyTournamentContentIssue(database(), 'a', { ...ctx, screening_hours_fingerprint: 'old' })).toContain('times changed');
  });
  it('blocks changed facts before any hours request', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await legacyTournamentContentIssue(database(4), 'a', ctx)).toContain('Screening changed');
    expect(fetch).not.toHaveBeenCalled();
  });
});

it.each([
  { screening_template_version: undefined }, { screening_template_version: 'old' },
  { ctaUrl: 'https://unapproved.example/checkout' }, { linkInBioUrl: 'javascript:alert(1)' },
  { booking_url: 'https://www.the-anchor.pub/book-table?fixture_id=other' },
])('blocks an unapproved content contract before fetching hours: %j', async change => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await legacyTournamentContentIssue(database(), 'a', { ...ctx, ...change })).toMatch(/template|destination/);
  expect(fetch).not.toHaveBeenCalled();
});


describe('legacy owner-approved terrestrial delivery', () => {
  const approval = { showing: true, screening_decision: 'unconfirmed', planned_end_at: null, linear_channel: null, screen_label: null };
  function stubHours(state = 'open', start = '12:00', end = '22:00') {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: { schemaVersion: 1, timezone: 'Europe/London', days: [{ date: '2026-11-07', state, fingerprint: 'fp', bar: state === 'open' ? { startAt: `2026-11-07T${start}:00Z`, endAt: `2026-11-07T${end}:00Z` } : null }] } })));
  }
  it('allows approved terrestrial games without assigned channel, screen or match end', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z')); stubHours();
    expect(await legacyTournamentContentIssue(database(3, approval), 'a', ctx)).toBeNull();
  });
  it.each([
    { broadcast_checked_at: null }, { screening_confirmed_at: null },
    { broadcast_decision: 'not_linear' }, { screening_decision: 'not_showing' },
    { match_state: 'finished' }, { match_state: 'cancelled' }, { showing: false },
  ])('blocks invalid approval before delivery %j', async change => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z')); stubHours();
    expect(await legacyTournamentContentIssue(database(3, { ...approval, ...change }), 'a', ctx)).not.toBeNull();
  });
  it.each(['closed', 'unknown'])('blocks %s hours', async state => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z')); stubHours(state);
    expect(await legacyTournamentContentIssue(database(3, approval), 'a', ctx)).not.toBeNull();
  });
  it('blocks after the normal closing time even before the planning window ends', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T22:00:00Z')); stubHours();
    expect(await legacyTournamentContentIssue(database(3, { ...approval, kick_off_at: '2026-11-07T20:10:00Z' }), 'a', ctx)).not.toBeNull();
  });
  it('blocks a game with no overlap with opening hours', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z')); stubHours('open', '15:00');
    expect(await legacyTournamentContentIssue(database(3, approval), 'a', ctx)).not.toBeNull();
  });
});
