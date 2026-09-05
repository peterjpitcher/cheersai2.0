import { describe, it, expect } from 'vitest';
import { lintContent } from '@/lib/ai/content-rules';
import {
  buildTournamentOverlayData,
  buildTournamentContentPayload,
  computeStaggerOffset,
  computeScheduledFor,
  formatRoundLabel,
} from './generate';
import { resolveScreening, toScreeningFacts } from './screening';
import type { ScreeningDayHours } from '@/lib/management-app/screening-hours';
import type { Tournament, TournamentFixture } from '@/types/tournament';

describe('computeStaggerOffset', () => {
  it('should return 0 for the first fixture at a given time', () => {
    expect(computeStaggerOffset(0)).toBe(0);
  });

  it('should stagger by 5 minutes per index', () => {
    expect(computeStaggerOffset(1)).toBe(5 * 60 * 1000);
    expect(computeStaggerOffset(2)).toBe(10 * 60 * 1000);
    expect(computeStaggerOffset(3)).toBe(15 * 60 * 1000);
  });
});

describe('formatRoundLabel', () => {
  it('should return "Group B" when groupName is "B"', () => {
    expect(formatRoundLabel('group_stage', 'B')).toBe('Group B');
  });

  it('should strip leading "Group " to prevent double-prefix', () => {
    expect(formatRoundLabel('group_stage', 'Group B')).toBe('Group B');
  });

  it('should strip case-insensitively', () => {
    expect(formatRoundLabel('group_stage', 'group C')).toBe('Group C');
    expect(formatRoundLabel('group_stage', 'GROUP A')).toBe('Group A');
  });

  it('should handle whitespace around the prefix', () => {
    expect(formatRoundLabel('group_stage', '  Group  D ')).toBe('Group D');
  });

  it('should return ROUND_LABELS value for non-group rounds', () => {
    expect(formatRoundLabel('round_of_16', null)).toBe('Round of 16');
    expect(formatRoundLabel('quarter_final', null)).toBe('Quarter-Final');
    expect(formatRoundLabel('semi_final', null)).toBe('Semi-Final');
    expect(formatRoundLabel('final', null)).toBe('Final');
  });

  it('should fall back to raw round string for unknown rounds', () => {
    expect(formatRoundLabel('playoff', null)).toBe('playoff');
  });

  it('should use ROUND_LABELS when group_stage has no groupName', () => {
    expect(formatRoundLabel('group_stage', null)).toBe('Group');
  });
});

describe('computeScheduledFor', () => {
  it('should subtract lead hours from kick-off', () => {
    const kickOff = new Date('2026-06-14T19:00:00Z');
    const result = computeScheduledFor(kickOff, 24, 0);
    expect(result).toEqual(new Date('2026-06-13T19:00:00Z'));
  });

  it('should add stagger offset', () => {
    const kickOff = new Date('2026-06-14T19:00:00Z');
    const result = computeScheduledFor(kickOff, 24, 1);
    expect(result).toEqual(new Date('2026-06-13T19:05:00Z'));
  });
});

const tournament: Pick<Tournament, 'id' | 'houseRulesText' | 'postTemplate'> = {
  id: 'tournament-1',
  houseRulesText: null,
  postTemplate: '{team_a} vs {team_b}\n{date} at {time}',
};

const fixture: Pick<TournamentFixture, 'id' | 'teamA' | 'teamB' | 'kickOffAt' | 'round' | 'groupName' | 'bookingUrl'> = {
  id: 'fixture-1',
  teamA: 'Mexico',
  teamB: 'South Africa',
  kickOffAt: '2026-06-11T19:00:00.000Z',
  round: 'group_stage',
  groupName: 'A',
  bookingUrl: null,
};

describe('buildTournamentContentPayload', () => {
  it('uses fixture kick-off as the lint reference date for feed captions', () => {
    const scheduledFor = new Date('2026-06-10T19:00:00.000Z');
    const payload = buildTournamentContentPayload({
      tournament,
      fixture,
      platform: 'facebook',
      placement: 'feed',
      scheduledFor,
    });

    expect(payload.body).toContain('Thursday 11 June');
    expect(payload.body).toContain('Settle in at The Anchor');
    expect(payload.body).toContain('Book a table: https://www.the-anchor.pub/book-table.');
    expect(payload.promptContext).toEqual(expect.objectContaining({
      source: 'tournament',
      tournament_id: tournament.id,
      tournament_fixture_id: fixture.id,
      eventStart: '2026-06-11T19:00:00.000Z',
      placement: 'feed',
      ctaUrl: 'https://www.the-anchor.pub/book-table',
    }));

    const lint = lintContent({
      body: payload.body,
      platform: 'facebook',
      placement: 'feed',
      context: payload.promptContext,
      scheduledFor,
    });

    expect(lint.pass).toBe(true);
  });

  it('uses link-in-bio booking copy for Instagram feed captions', () => {
    const scheduledFor = new Date('2026-06-10T19:00:00.000Z');
    const payload = buildTournamentContentPayload({
      tournament,
      fixture,
      platform: 'instagram',
      placement: 'feed',
      scheduledFor,
    });

    expect(payload.body).toContain('Settle in at The Anchor');
    expect(payload.body).toContain('Book a table via the link in our bio.');
    expect(payload.body).not.toContain('https://www.the-anchor.pub/book-table');

    const lint = lintContent({
      body: payload.body,
      platform: 'instagram',
      placement: 'feed',
      context: payload.promptContext,
      scheduledFor,
    });

    expect(lint.pass).toBe(true);
  });

  it('creates empty story bodies that pass story lint', () => {
    const scheduledFor = new Date('2026-06-10T19:00:00.000Z');
    const payload = buildTournamentContentPayload({
      tournament,
      fixture,
      platform: 'instagram',
      placement: 'story',
      scheduledFor,
    });

    expect(payload.body).toBe('');
    expect(payload.promptContext).toEqual(expect.objectContaining({
      eventStart: '2026-06-11T19:00:00.000Z',
      placement: 'story',
    }));

    const lint = lintContent({
      body: payload.body,
      platform: 'instagram',
      placement: 'story',
      context: payload.promptContext,
      scheduledFor,
    });

    expect(lint.pass).toBe(true);
  });
});

describe('buildTournamentOverlayData', () => {
  it('uses display-safe team names for artwork while leaving fixture names intact elsewhere', () => {
    const overlay = buildTournamentOverlayData({
      tournament,
      fixture: {
        ...fixture,
        teamA: 'Canada',
        teamB: 'Bosnia and Herzegovina',
      },
    });

    expect(overlay).toEqual(expect.objectContaining({
      teamA: 'Canada',
      teamB: 'Bosnia & Herz.',
      dateDisplay: 'Thursday 11 June',
      timeDisplay: '8:00 PM',
      roundLabel: 'Group A',
    }));
  });
});


describe('owner-approved rugby copy', () => {
  it('omits unassigned screens and commentary whilst retaining booking and food details', () => {
    const game = { ...fixture, teamA: 'England', teamB: 'Japan', kickOffAt: '2026-11-14T16:40:00Z', showing: true, teamsConfirmed: true, screeningDecision: 'unconfirmed', broadcastDecision: 'confirmed', broadcastCheckedAt: '2026-09-05T09:00:00Z', screeningConfirmedAt: '2026-09-05T09:00:00Z' } as TournamentFixture;
    const facts = toScreeningFacts(game, 'rugby_union');
    const hours: ScreeningDayHours = { date: '2026-11-14', state: 'open', regularOpensAt: '2026-11-14T12:00:00Z', bar: { startAt: '2026-11-14T12:00:00Z', endAt: '2026-11-14T22:00:00Z' }, kitchen: [{ startAt: '2026-11-14T12:00:00Z', endAt: '2026-11-14T19:00:00Z' }], kitchenState: 'known', hasSpecialHours: false, fingerprint: 'verified-hours' };
    const screened = { ...facts, hours, screening: resolveScreening(facts, hours, new Date('2026-09-05T09:00:00Z')) };
    const payload = buildTournamentContentPayload({ tournament, fixture: game, screened, platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-13T16:40:00Z') });
    expect(payload.body).toContain('Book a table for this game');
    expect(payload.body).toContain('Kitchen service 12:00 to 19:00');
    expect(payload.body).not.toMatch(/Screen:|commentary|null|undefined/i);
  });
});


describe('rugby menu links follow actual food service', () => {
  it.each([
    ['2026-11-08', '15:10', '13:00', '18:00', 'known', '/sunday-roast'],
    ['2026-11-08', '20:10', '13:00', '18:00', 'known', '/sunday-roast'],
    ['2026-11-07', '16:40', '12:00', '19:00', 'known', '/food-menu'],
    ['2026-11-08', '15:10', '13:00', '18:00', 'unknown', null],
    ['2026-11-08', '15:10', null, null, 'known', null],
  ] as const)('uses the correct menu for %s %s with kitchen state %s', (date, kick, start, end, kitchenState, menu) => {
    const game = { ...fixture, kickOffAt: `${date}T${kick}:00Z`, showing: true, teamsConfirmed: true, screeningDecision: 'unconfirmed', broadcastDecision: 'confirmed', broadcastCheckedAt: '2026-09-05T09:00:00Z', screeningConfirmedAt: '2026-09-05T09:00:00Z' } as TournamentFixture;
    const facts = toScreeningFacts(game, 'rugby_union');
    const hours: ScreeningDayHours = { date, state: 'open', regularOpensAt: `${date}T12:00:00Z`, bar: { startAt: `${date}T12:00:00Z`, endAt: `${date}T22:00:00Z` }, kitchen: start && end ? [{ startAt: `${date}T${start}:00Z`, endAt: `${date}T${end}:00Z` }] : [], kitchenState, hasSpecialHours: false, fingerprint: 'verified-menu-hours' };
    const screened = { ...facts, hours, screening: resolveScreening(facts, hours, new Date('2026-09-05T09:00:00Z')) };
    const payload = buildTournamentContentPayload({ tournament, fixture: game, screened, platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-06T09:00:00Z') });
    if (menu) {
      expect(payload.body).toContain(`https://www.the-anchor.pub${menu}`);
      expect(payload.body).not.toContain(menu === '/sunday-roast' ? '/food-menu' : '/sunday-roast');
    } else expect(payload.body).not.toMatch(/View the .*menu/);
    const instagram = buildTournamentContentPayload({ tournament, fixture: game, screened, platform: 'instagram', placement: 'feed', scheduledFor: new Date('2026-11-06T09:00:00Z') });
    expect(instagram.body).not.toMatch(/https?:|View the .*menu:/);
    expect(lintContent({ body: payload.body, platform: 'facebook', placement: 'feed', context: payload.promptContext, scheduledFor: new Date('2026-11-06T09:00:00Z') }).pass).toBe(true);
  });
});


it.each([
  { source: 'campaign', screening_sport: 'rugby_union', screening_menu_url: 'https://www.the-anchor.pub/sunday-roast' },
  { source: 'tournament', screening_sport: 'football', screening_menu_url: 'https://www.the-anchor.pub/sunday-roast' },
  { source: 'tournament', screening_sport: 'rugby_union', screening_menu_url: 'https://unapproved.example/menu' },
])('does not widen menu permissions to unrelated content %j', context => {
  const result = lintContent({ body: `View the menu: ${context.screening_menu_url}. Book a table: https://www.the-anchor.pub/book-table`, platform: 'facebook', placement: 'feed', context: { ...context, ctaUrl: 'https://www.the-anchor.pub/book-table' }, scheduledFor: new Date('2026-11-06T09:00:00Z') });
  expect(result.issues.some(issue => issue.code === 'url_disallowed')).toBe(true);
});
