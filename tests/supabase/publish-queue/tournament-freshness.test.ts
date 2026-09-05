import { NATIONS_TEMPLATE_VERSION, nationsContentLinks } from '../../../supabase/functions/_shared/nations-content-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyTournamentContentIssue } from '../../../supabase/functions/publish-queue/tournament-freshness';
import type { SupabaseClient } from '@supabase/supabase-js';
const ctx = { screening_template_version: NATIONS_TEMPLATE_VERSION, ...nationsContentLinks('f', '2026-11-07'), source: 'tournament', tournament_id: 't', tournament_fixture_id: 'f', tournament_updated_at: 'updated', screening_revision: 3, screening_hours_fingerprint: 'fp' };
function database(revision = 3): SupabaseClient {
  const rows: Record<string, unknown> = {
    tournaments: { id: 't', sport: 'rugby_union', status: 'active', updated_at: 'updated' },
    tournament_fixtures: { content_revision: revision, screening_decision: 'confirmed', broadcast_decision: 'confirmed', teams_confirmed: true, planned_end_at: '2026-11-07T14:00:00Z', kick_off_at: '2026-11-07T12:00:00Z', match_state: 'scheduled' },
    management_app_connections: { base_url: 'https://management.example.test', api_key: 'test-key', enabled: true },
  };
  return { from: (table: string) => { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: rows[table], error: null }) }; return chain; } } as unknown as SupabaseClient;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('legacy screening delivery gate', () => {
  it('allows only unchanged current hours', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    const fetch = vi.fn().mockImplementation(async () => Response.json({ success: true, data: { schemaVersion: 1, timezone: 'Europe/London', days: [{ date: '2026-11-07', state: 'open', fingerprint: 'fp' }] } }));
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
