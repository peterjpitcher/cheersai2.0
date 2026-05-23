import { describe, it, expect } from 'vitest';
import { lintContent } from '@/lib/ai/content-rules';
import {
  buildTournamentContentPayload,
  computeStaggerOffset,
  computeScheduledFor,
  formatRoundLabel,
} from './generate';
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
    expect(payload.promptContext).toEqual(expect.objectContaining({
      source: 'tournament',
      tournament_id: tournament.id,
      tournament_fixture_id: fixture.id,
      eventStart: '2026-06-11T19:00:00.000Z',
      placement: 'feed',
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
