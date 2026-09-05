import { DateTime } from 'luxon';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchScreeningHours, unknownScreeningHours, type ScreeningDayHours } from '@/lib/management-app/screening-hours';
import { resolveScreening, toScreeningFacts, type ScreeningProjection } from './screening';
import type { Tournament, TournamentFixture, ScreeningFacts } from '@/types/tournament';
// Owner-confirmed policy, 5 September 2026, recorded in the website docs/SSOT.md.
const ANCHOR_ACCOUNT_ID = '91fda684-2801-4abb-980e-f42cec017cef';
export interface ScreenedFixture extends ScreeningFacts { hours: ScreeningDayHours; screening: ScreeningProjection }
export async function projectTournamentFixtures(db: SupabaseClient, tournament: Tournament, fixtures: TournamentFixture[], now = new Date()): Promise<ScreenedFixture[]> {
  const today = DateTime.fromJSDate(now).setZone('Europe/London').toISODate()!;
  const dates = [...new Set(fixtures.map(f => DateTime.fromISO(f.kickOffAt).setZone('Europe/London').toISODate()!).filter(date => date >= today))];
  const days = new Map<string, ScreeningDayHours>();
  if (dates.length) {
    try {
      const { data, error } = await db.from('management_app_connections').select('base_url, api_key, enabled').eq('account_id', tournament.accountId).maybeSingle();
      if (error || !data?.enabled || !data.api_key) throw new Error('Management connection unavailable');
      for (let offset = 0; offset < dates.length; offset += 31) {
        const response = await fetchScreeningHours(dates.slice(offset, offset + 31), { baseUrl: data.base_url, apiKey: data.api_key });
        for (const day of response.days) days.set(day.date, day);
      }
    } catch { /* Fail closed per date; fixture facts remain useful when hours are unavailable. */ }
  }
  return fixtures.map(fixture => {
    const date = DateTime.fromISO(fixture.kickOffAt).setZone('Europe/London').toISODate()!;
    const hours = days.get(date) ?? unknownScreeningHours(date);
    const facts = toScreeningFacts(fixture, tournament.sport);
    const screening = resolveScreening(facts, hours, now, tournament.accountId === ANCHOR_ACCOUNT_ID ? 'stay_open_if_viewers' : undefined);
    const startsLate = Boolean(screening.screeningStartAt && Date.parse(screening.screeningStartAt) > Date.parse(facts.kickOffAt));
    const plannedEnd = facts.plannedEndAt ? Date.parse(facts.plannedEndAt) : Date.parse(facts.kickOffAt) + 120 * 60_000;
    const endsEarly = Boolean(screening.screeningEndAt && Date.parse(screening.screeningEndAt) < plannedEnd);
    const coverage = startsLate && endsEarly ? 'from_opening_until_closing' : startsLate ? 'from_opening' : endsEarly ? 'until_closing' : 'full';
    return { ...facts, coverage, hours, screening };
  });
}
