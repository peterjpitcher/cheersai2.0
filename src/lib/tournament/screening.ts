import { DateTime } from 'luxon';
import type { ScreeningDayHours, ServiceWindow } from '@/lib/management-app/screening-hours';
import type { ScreeningFacts, TournamentFixture, TournamentSport } from '@/types/tournament';
import { areBothTeamsConfirmed } from './placeholder';
export type { ScreeningFacts } from '@/types/tournament';

export interface ScreeningProjection {
  status: 'awaiting_channel' | 'awaiting_decision' | 'hours_unknown' | 'opening_conflict' |
    'confirmed_full' | 'confirmed_partial' | 'not_showing' | 'finished' | 'cancelled';
  screeningStartAt: string | null;
  screeningEndAt: string | null;
  openingLabel: string;
  kitchenLabel: string;
  foodPromotion: {
    kind: 'during_screening' | 'before_match' | 'none' | 'unknown';
    serviceWindows: ServiceWindow[];
    overlapWindows: ServiceWindow[];
    message: string | null;
  };
  canBookForScreening: boolean;
  canGenerateTeamPromotion: boolean;
  hoursFingerprint: string;
}

export function toScreeningFacts(fixture: TournamentFixture, sport: TournamentSport = 'football'): ScreeningFacts {
  return {
    id: fixture.id, importKey: fixture.importKey ?? fixture.id, sport, round: fixture.round,
    roundNumber: fixture.roundNumber ?? null, finalPosition: fixture.finalPosition ?? null,
    teamA: fixture.teamA, teamB: fixture.teamB, teamsConfirmed: fixture.teamsConfirmed,
    kickOffAt: fixture.kickOffAt, plannedEndAt: fixture.plannedEndAt ?? null,
    matchState: fixture.matchState ?? 'scheduled', screeningDecision: fixture.screeningDecision ?? 'unconfirmed',
    broadcastDecision: fixture.broadcastDecision ?? 'unconfirmed', linearChannel: fixture.linearChannel ?? null,
    screenLabel: fixture.screenLabel ?? null, commentary: fixture.commentary ?? 'unconfirmed', coverage: 'full',
    sourceUrl: fixture.sourceUrl ?? null, sourceCheckedAt: fixture.sourceCheckedAt ?? null,
    broadcastCheckedAt: fixture.broadcastCheckedAt ?? null, screeningConfirmedAt: fixture.screeningConfirmedAt ?? null,
    contentRevision: fixture.contentRevision ?? 1, bookingUrl: fixture.bookingUrl,
  };
}

export function intersectServiceWindows(first: ServiceWindow, second: ServiceWindow): ServiceWindow | null {
  const start = Math.max(Date.parse(first.startAt), Date.parse(second.startAt));
  const end = Math.min(Date.parse(first.endAt), Date.parse(second.endAt));
  return Number.isFinite(start) && Number.isFinite(end) && start < end
    ? { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() } : null;
}

function clock(value: string): string {
  return DateTime.fromISO(value).setZone('Europe/London').toFormat('HH:mm');
}
function describeWindows(windows: ServiceWindow[]): string {
  return windows.map(w => `${clock(w.startAt)} to ${clock(w.endAt)}`).join(' and ');
}

export function resolveScreening(fixture: ScreeningFacts, hours: ScreeningDayHours, now: Date): ScreeningProjection {
  const result: ScreeningProjection = {
    status: 'awaiting_decision', screeningStartAt: null, screeningEndAt: null,
    openingLabel: hours.state === 'open' && hours.bar ? `Pub open ${describeWindows([hours.bar])}` : hours.state === 'closed' ? 'Pub closed' : 'Opening times unavailable; check before travelling',
    kitchenLabel: hours.kitchenState === 'unknown' ? 'Kitchen times unavailable' : hours.kitchen.length ? `Kitchen service ${describeWindows(hours.kitchen)}` : 'Kitchen closed',
    foodPromotion: { kind: 'none', serviceWindows: [], overlapWindows: [], message: null },
    canBookForScreening: false, canGenerateTeamPromotion: false, hoursFingerprint: hours.fingerprint,
  };
  if (fixture.matchState === 'cancelled' || fixture.matchState === 'finished') return { ...result, status: fixture.matchState };
  if (fixture.screeningDecision === 'not_showing' || fixture.broadcastDecision === 'not_linear') return { ...result, status: 'not_showing' };
  if (fixture.broadcastDecision !== 'confirmed' || !fixture.linearChannel?.trim() || !fixture.broadcastCheckedAt) return { ...result, status: 'awaiting_channel' };
  if (fixture.screeningDecision !== 'confirmed' || !fixture.screenLabel?.trim() || !fixture.screeningConfirmedAt) return result;
  const kick = Date.parse(fixture.kickOffAt);
  const end = Date.parse(fixture.plannedEndAt ?? '');
  if (!Number.isFinite(kick) || !Number.isFinite(end) || end <= kick) return result;
  if (hours.state === 'unknown' || (hours.state === 'open' && !hours.bar) || hours.date !== DateTime.fromISO(fixture.kickOffAt).setZone('Europe/London').toISODate()) return { ...result, status: 'hours_unknown' };
  if (hours.state === 'closed' || !hours.bar) return { ...result, status: 'opening_conflict' };
  const open = Date.parse(hours.bar.startAt), close = Date.parse(hours.bar.endAt);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return { ...result, status: 'hours_unknown' };
  if (open >= end || close < end) return { ...result, status: 'opening_conflict' };
  result.status = open > kick ? 'confirmed_partial' : 'confirmed_full';
  result.screeningStartAt = new Date(Math.max(open, kick)).toISOString();
  result.screeningEndAt = new Date(end).toISOString();
  if (open > kick) result.openingLabel = `Showing from ${clock(hours.bar.startAt)}; kick-off ${clock(fixture.kickOffAt)}, start missed`;
  // An elapsed planned end suppresses future offers without inventing a final result.
  result.canBookForScreening = Number.isFinite(now.getTime()) && now.getTime() < end;
  result.canGenerateTeamPromotion = result.canBookForScreening && fixture.teamsConfirmed && areBothTeamsConfirmed(fixture.teamA, fixture.teamB);
  if (hours.kitchenState === 'unknown') {
    result.foodPromotion.kind = 'unknown';
    return result;
  }
  const serviceWindows = hours.kitchen.map(w => intersectServiceWindows(w, hours.bar!)).filter((w): w is ServiceWindow => w !== null).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const overlapWindows = serviceWindows.map(w => intersectServiceWindows(w, { startAt: result.screeningStartAt!, endAt: result.screeningEndAt! })).filter((w): w is ServiceWindow => w !== null);
  if (overlapWindows.length) {
    result.foodPromotion = { kind: 'during_screening', serviceWindows, overlapWindows, message: `Book a table for food and rugby. Kitchen service ${describeWindows(serviceWindows)}.` };
  } else {
    const before = serviceWindows.filter(w => Date.parse(w.endAt) <= kick && DateTime.fromISO(w.startAt).setZone('Europe/London').toISODate() === hours.date);
    if (before.length) result.foodPromotion = { kind: 'before_match', serviceWindows: before, overlapWindows: [], message: `Book for pre-match food. Kitchen service ${describeWindows(before)}.` };
  }
  return result;
}
