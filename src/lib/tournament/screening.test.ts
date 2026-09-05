import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { resolveScreening, intersectServiceWindows, toScreeningFacts } from './screening';
import type { ScreeningFacts, TournamentFixture } from '@/types/tournament';
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


const approved: ScreeningFacts = {
  ...fixture, bookingApproved: true, plannedEndAt: null, linearChannel: null,
  screenLabel: null, commentary: 'unconfirmed', screeningDecision: 'unconfirmed',
};
describe('owner-approved terrestrial bookings', () => {
  it('maps the saved showing decision independently of operational confirmation', () => {
    expect(toScreeningFacts({ showing: true } as TournamentFixture).bookingApproved).toBe(true);
    expect(toScreeningFacts({ showing: false } as TournamentFixture).bookingApproved).toBe(false);
  });
  it('accepts terrestrial approval without inventing a channel, screen or match finish', () => {
    const result = resolveScreening(approved, hours, now);
    expect(result.canBookForScreening).toBe(true);
    expect(result.screeningStartAt).toBe('2026-11-07T12:00:00.000Z');
    expect(result.screeningEndAt).toBe('2026-11-07T13:40:00.000Z');
    expect(approved.plannedEndAt).toBeNull();
    expect(result.openingLabel).toContain('start missed');
  });
  it.each([
    [{ broadcastDecision: 'unconfirmed' }, hours, 'awaiting_channel'],
    [{ broadcastCheckedAt: null }, hours, 'awaiting_channel'],
    [{ screeningConfirmedAt: null }, hours, 'awaiting_decision'],
    [{ broadcastDecision: 'not_linear' }, hours, 'not_showing'],
    [{ screeningDecision: 'not_showing' }, hours, 'not_showing'],
    [{ matchState: 'cancelled' }, hours, 'cancelled'],
    [{ matchState: 'finished' }, hours, 'finished'],
    [{}, { ...hours, state: 'unknown', bar: null }, 'hours_unknown'],
    [{}, { ...hours, state: 'closed', bar: null }, 'opening_conflict'],
    [{}, { ...hours, bar: window('14:00', '22:00') }, 'opening_conflict'],
    [{ bookingApproved: false }, hours, 'awaiting_channel'],
  ] as const)('retains safeguards for %j', (change, day, status) => {
    const result = resolveScreening({ ...approved, ...change }, day, now);
    expect(result.status).toBe(status);
    expect(result.canBookForScreening).toBe(false);
  });
  it('clips late bookings to closing and promotes pre-match food when the kitchen shuts at 19:00', () => {
    const result = resolveScreening({ ...approved, kickOffAt: at('20:10') }, hours, now);
    expect(result.status).toBe('confirmed_partial');
    expect(result.screeningEndAt).toBe('2026-11-07T22:00:00.000Z');
    expect(result.openingLabel).toContain('the end of the match may be missed');
    expect(result.foodPromotion.kind).toBe('before_match');
    expect(result.foodPromotion.message).toContain('12:00 to 19:00');
    expect(resolveScreening({ ...approved, kickOffAt: at('20:10') }, hours, new Date(at('22:00'))).canBookForScreening).toBe(false);
  });
  it('promotes food during late games only until the actual 21:00 kitchen close', () => {
    const result = resolveScreening({ ...approved, kickOffAt: at('20:10') }, { ...hours, kitchen: [window('12:00','15:00'), window('16:00','21:00')] }, now);
    expect(result.foodPromotion.kind).toBe('during_screening');
    expect(result.foodPromotion.overlapWindows).toEqual([{ startAt: '2026-11-07T20:10:00.000Z', endAt: '2026-11-07T21:00:00.000Z' }]);
    expect(result.foodPromotion.message).toContain('12:00 to 15:00 and 16:00 to 21:00');
  });
  it('warns about both ends when the viewing window is shorter than the game', () => {
    const result = resolveScreening(approved, { ...hours, bar: window('12:00','13:00') }, now);
    expect(result.status).toBe('confirmed_partial');
    expect(result.canBookForScreening).toBe(true);
    expect(result.openingLabel).toContain('start missed');
    expect(result.openingLabel).toContain('end of the match may be missed');
    expect(result.screeningEndAt).toBe('2026-11-07T13:00:00.000Z');
  });
  const rows = readFileSync('docs/imports/nations-championship-2026.csv', 'utf8').trim().split('\n').slice(1).map(line => line.split(','));
  it('covers every imported November fixture', () => expect(rows).toHaveLength(24));
  it.each(rows.map(row => [row[5], row[4], row[6]]))('keeps %s bookable within existing hours', (_key, kickOffAt, teams) => {
    const date = DateTime.fromISO(kickOffAt).setZone('Europe/London').toISODate()!;
    const dayWindow = (start: string, end: string) => ({ startAt: `${date}T${start}:00Z`, endAt: `${date}T${end}:00Z` });
    const weekday = DateTime.fromISO(kickOffAt).setZone('Europe/London').weekday;
    const dayHours: ScreeningDayHours = { ...hours, date, regularOpensAt: `${date}T12:00:00Z`, bar: dayWindow('12:00','22:00'), kitchen: weekday === 5 ? [dayWindow('12:00','15:00'), dayWindow('16:00','21:00')] : weekday === 7 ? [dayWindow('13:00','18:00')] : [dayWindow('12:00','19:00')] };
    const result = resolveScreening({ ...approved, kickOffAt, teamsConfirmed: teams === 'true' }, dayHours, new Date('2026-09-05T09:00:00Z'));
    expect(result.canBookForScreening).toBe(true);
    expect(Date.parse(result.screeningStartAt!)).toBeGreaterThanOrEqual(Date.parse(dayHours.bar!.startAt));
    expect(Date.parse(result.screeningEndAt!)).toBeLessThanOrEqual(Date.parse(dayHours.bar!.endAt));
    expect(result.canGenerateTeamPromotion).toBe(teams === 'true');
  });
});
