import { describe, expect, it } from 'vitest';
import { resolveScreening, intersectServiceWindows } from './screening';
import type { ScreeningFacts } from '@/types/tournament';
import type { ScreeningDayHours } from '@/lib/management-app/screening-hours';
const at = (time: string) => `2026-11-07T${time}:00Z`;
const window = (start: string, end: string) => ({ startAt: at(start), endAt: at(end) });
const fixture: ScreeningFacts = {
  id: 'fixture', importKey: 'fixture', sport: 'rugby_union', round: 'league_round', roundNumber: 4, finalPosition: null,
  teamA: 'Italy', teamB: 'South Africa', teamsConfirmed: true, kickOffAt: at('11:40'), plannedEndAt: at('13:40'),
  matchState: 'scheduled', screeningDecision: 'confirmed', broadcastDecision: 'confirmed', linearChannel: 'Test channel',
  screenLabel: 'Main', commentary: 'on', coverage: 'full', sourceUrl: null, sourceCheckedAt: null,
  broadcastCheckedAt: at('09:00'), screeningConfirmedAt: at('09:00'), contentRevision: 1, bookingUrl: null,
};
const hours: ScreeningDayHours = { date: '2026-11-07', state: 'open', regularOpensAt: at('12:00'), bar: window('12:00','22:00'), kitchen: [window('12:00','19:00')], kitchenState: 'known', hasSpecialHours: false, fingerprint: 'hours-1' };
const now = new Date(at('09:00'));
describe('screening policy', () => {
  it('automatically keeps a booking CTA for an early match shown from normal opening', () => {
    const result = resolveScreening(fixture, hours, now);
    expect(result.status).toBe('confirmed_partial');
    expect(result.screeningStartAt).toBe(at('12:00').replace('Z','.000Z'));
    expect(result.openingLabel).toContain('start missed');
    expect(result.canBookForScreening).toBe(true);
    expect(result.foodPromotion.message).toContain('12:00 to 19:00');
    expect(result.foodPromotion.overlapWindows).toEqual([window('12:00','13:40')].map(w => ({startAt:new Date(w.startAt).toISOString(),endAt:new Date(w.endAt).toISOString()})));
  });
  it.each([
    [{ plannedEndAt: null }, hours, 'awaiting_decision'],
    [{ broadcastDecision: 'not_linear' }, hours, 'not_showing'],
    [{ broadcastCheckedAt: null }, hours, 'awaiting_channel'],
    [{}, { ...hours, state: 'unknown', bar: null }, 'hours_unknown'],
    [{}, { ...hours, bar: window('12:00','13:00') }, 'opening_conflict'],
    [{}, { ...hours, state: 'closed', bar: null }, 'opening_conflict'],
    [{ matchState: 'cancelled' }, hours, 'cancelled'],
  ] as const)('fails closed for unavailable screening facts %j', (change, day, status) => {
    const result = resolveScreening({ ...fixture, ...change }, day, now);
    expect(result.status).toBe(status);
    expect(result.canBookForScreening).toBe(false);
    expect(result.foodPromotion.kind).toBe('none');
  });
  it('blocks team promotion for explicit unknown finalists and false confirmations', () => {
    expect(resolveScreening({ ...fixture, teamA: 'Europe 6th' }, hours, now).canGenerateTeamPromotion).toBe(false);
    expect(resolveScreening({ ...fixture, teamsConfirmed: false }, hours, now).canGenerateTeamPromotion).toBe(false);
  });
  it('does not infer a result after planned end', () => {
    const result = resolveScreening(fixture, hours, new Date(at('14:00')));
    expect(result.status).toBe('confirmed_partial');
    expect(result.canBookForScreening).toBe(false);
  });
  it('preserves split food service and identifies pre-match food separately', () => {
    const split = resolveScreening({ ...fixture, kickOffAt: at('14:00'), plannedEndAt: at('17:00') }, { ...hours, kitchen: [window('12:00','15:00'), window('16:00','21:00')] }, now);
    expect(split.foodPromotion.overlapWindows).toHaveLength(2);
    expect(split.foodPromotion.message).toContain('12:00 to 15:00 and 16:00 to 21:00');
    const before = resolveScreening({ ...fixture, kickOffAt: at('20:00'), plannedEndAt: at('22:00') }, hours, now);
    expect(before.foodPromotion.kind).toBe('before_match');
    expect(before.foodPromotion.message).toContain('pre-match');
  });
  it('allows drinks bookings with closed or unknown kitchen', () => {
    expect(resolveScreening(fixture, { ...hours, kitchen: [] }, now).foodPromotion.kind).toBe('none');
    const result = resolveScreening(fixture, { ...hours, kitchenState: 'unknown' }, now);
    expect(result.foodPromotion.kind).toBe('unknown');
    expect(result.canBookForScreening).toBe(true);
  });
  it('does not count touching service endpoints as overlap', () => {
    expect(intersectServiceWindows(window('12:00','13:00'), window('13:00','14:00'))).toBeNull();
  });
});
