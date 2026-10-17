import { describe, expect, it } from 'vitest';

import type { ScreeningDayHours } from '@/lib/management-app/screening-hours';
import type { TournamentFixture } from '@/types/tournament';

import { buildRugbyMatchCopy, buildRugbyMenuLine, buildRugbyOpeningLine, buildRugbyRoundupCopy, describeMinutes, isRugbyListLine, joinRugbyParagraphs } from './rugby-copy';
import { resolveScreening, toScreeningFacts } from './screening';

function screen(kickOffAt: string, kitchen: Array<[string, string]>, policy?: 'stay_open_if_viewers') {
  const date = kickOffAt.slice(0, 10);
  const fixture = {
    id: 'fixture-1', teamA: 'Wales', teamB: 'Japan', kickOffAt, round: 'league_round', groupName: null, bookingUrl: null,
    showing: true, teamsConfirmed: true, screeningDecision: 'unconfirmed', broadcastDecision: 'confirmed',
    broadcastCheckedAt: '2026-09-05T09:00:00Z', screeningConfirmedAt: '2026-09-05T09:00:00Z',
  } as TournamentFixture;
  const facts = toScreeningFacts(fixture, 'rugby_union');
  const hours: ScreeningDayHours = {
    date, state: 'open', regularOpensAt: `${date}T12:00:00Z`,
    bar: { startAt: `${date}T12:00:00Z`, endAt: `${date}T22:00:00Z` },
    kitchen: kitchen.map(([start, end]) => ({ startAt: `${date}T${start}:00Z`, endAt: `${date}T${end}:00Z` })),
    kitchenState: 'known', hasSpecialHours: false, fingerprint: 'fp',
  };
  return { fixture, screened: { ...facts, hours, screening: resolveScreening(facts, hours, new Date('2026-09-05T09:00:00Z'), policy) } };
}

describe('describeMinutes', () => {
  it.each([
    [1, '1 minute'], [20, '20 minutes'], [60, 'an hour'], [70, '1 hour and 10 minutes'], [120, '2 hours'], [135, '2 hours and 15 minutes'],
  ])('describes %i minutes as "%s"', (minutes, text) => {
    expect(describeMinutes(minutes)).toBe(text);
  });
});

describe('buildRugbyOpeningLine', () => {
  it('uses 12-hour time and the house date style, and is stable for a fixture', () => {
    const fixture = { id: 'abc', teamA: 'England', teamB: 'Japan', kickOffAt: '2026-11-14T16:40:00Z' };
    const line = buildRugbyOpeningLine(fixture);
    expect(line).toContain('England v Japan');
    expect(line).toContain('Saturday 14th November');
    expect(line).toContain('4:40pm');
    expect(line).not.toMatch(/16:40|PM/);
    expect(buildRugbyOpeningLine(fixture)).toBe(line);
  });

  it('varies the opening between fixtures', () => {
    const openings = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id =>
      buildRugbyOpeningLine({ id, teamA: 'England', teamB: 'Japan', kickOffAt: '2026-11-14T16:40:00Z' })));
    expect(openings.size).toBeGreaterThan(1);
  });
});

describe('buildRugbyMatchCopy', () => {
  it('states full coverage as opening hours on the image and adds no caveat to the caption', () => {
    const { fixture, screened } = screen('2026-11-14T16:40:00Z', [['12:00', '19:00']]);
    const copy = buildRugbyMatchCopy({ fixture, screened });
    expect(copy.lines).toHaveLength(2);
    expect(copy.requiredLines).toEqual(['Kitchen times: 12pm to 7pm, so you can eat while you watch.']);
    expect(copy.imageNote).toBe('Open 12pm to 10pm. Kitchen 12pm to 7pm.');
  });

  it('says when doors open after kick-off', () => {
    const { fixture, screened } = screen('2026-11-14T11:40:00Z', [['12:00', '19:00']]);
    const copy = buildRugbyMatchCopy({ fixture, screened });
    expect(copy.lines).toContain("We open at 12pm, 20 minutes after kick-off, so you'll catch the rest of the game.");
    expect(copy.imageNote).toBe('Doors 12pm, 20 minutes after kick-off. Kitchen 12pm to 7pm.');
  });

  it('keeps the stay-open promise conditional and limits arrivals to the usual close', () => {
    const { fixture, screened } = screen('2026-11-14T20:10:00Z', [['12:00', '15:00'], ['16:00', '21:00']], 'stay_open_if_viewers');
    const copy = buildRugbyMatchCopy({ fixture, screened });
    expect(copy.lines).toContain("We usually close at 10pm. If you're still here watching, we'll stay open until the final whistle. Please arrive before 10pm.");
    expect(copy.imageNote).toBe("Usually close 10pm, open to the final whistle if you're still watching. Kitchen 12pm to 3pm and 4pm to 9pm.");
  });

  it('suggests eating before kick-off when the kitchen closes first', () => {
    const { fixture, screened } = screen('2026-11-14T20:10:00Z', [['12:00', '19:00']]);
    const copy = buildRugbyMatchCopy({ fixture, screened });
    expect(copy.lines).toContain('Kitchen times: 12pm to 7pm, so you can eat before kick-off.');
    expect(copy.lines).toContain('We close at 10pm, before the final whistle, so you may miss the end.');
  });
});

describe('buildRugbyMenuLine', () => {
  it('links the Sunday roast menu on Sundays and the main menu otherwise', () => {
    expect(buildRugbyMenuLine('2026-11-08T15:10:00Z', 'https://www.the-anchor.pub/sunday-roast'))
      .toBe('See our Sunday roast menu: https://www.the-anchor.pub/sunday-roast');
    expect(buildRugbyMenuLine('2026-11-07T15:10:00Z', 'https://www.the-anchor.pub/food-menu'))
      .toBe('See our menu: https://www.the-anchor.pub/food-menu');
    expect(buildRugbyMenuLine('2026-11-07T15:10:00Z', null)).toBeNull();
  });
});

describe('buildRugbyRoundupCopy', () => {
  function day(policy?: 'stay_open_if_viewers') {
    return [
      { kickOffAt: '2026-11-07T11:40:00Z', id: 'a', teamA: 'Italy', teamB: 'South Africa' },
      { kickOffAt: '2026-11-07T14:10:00Z', id: 'b', teamA: 'Scotland', teamB: 'New Zealand' },
      { kickOffAt: '2026-11-07T20:10:00Z', id: 'c', teamA: 'France', teamB: 'Fiji' },
    ].map((game) => {
      const { screened } = screen(game.kickOffAt, [['12:00', '19:00']], policy);
      return { fixture: { ...game }, screened: { ...screened, id: game.id, teamA: game.teamA, teamB: game.teamB } };
    });
  }

  it('lists every game in kick-off order with notes for the games they apply to', () => {
    const copy = buildRugbyRoundupCopy(day('stay_open_if_viewers'));
    expect(copy.lines[0]).toMatch(/[Tt]hree games/);
    expect(copy.lines[0]).toContain('Saturday 7th November');
    expect(copy.lines.slice(1, 4)).toEqual(['11:40am Italy v South Africa', '2:10pm Scotland v New Zealand', '8:10pm France v Fiji']);
    expect(copy.lines).toContain("We open at 12pm, 20 minutes after the 11:40am kick-off, so you'll catch the rest of that game.");
    // The stay-open policy sits on the late game, not the day's first game.
    expect(copy.lines).toContain("We usually close at 10pm. If you're still here watching the 8:10pm game, we'll stay open until the final whistle. Please arrive before 10pm.");
    expect(copy.lines).toContain('Kitchen times: 12pm to 7pm, so you can eat while you watch.');
    expect(copy.requiredLines).toHaveLength(3);
    expect(copy.imageNote).toBe("Doors 12pm. Usually close 10pm, open to the final whistle if you're still watching. Kitchen 12pm to 7pm.");
  });

  it('is honest about the late finish for a brand without the stay-open policy', () => {
    const copy = buildRugbyRoundupCopy(day());
    expect(copy.lines).toContain('We close at 10pm, before the final whistle of the 8:10pm game, so you may miss the end.');
    expect(copy.lines.join(' ')).not.toContain('stay open');
  });

  it('keeps the fixture list tight and every other paragraph spaced', () => {
    const text = joinRugbyParagraphs(['Three games on our screens.', '2:10pm England v Japan', '4:40pm Wales v Fiji', 'Kitchen times: 12pm to 7pm.']);
    expect(text).toBe('Three games on our screens.\n\n2:10pm England v Japan\n4:40pm Wales v Fiji\n\nKitchen times: 12pm to 7pm.');
    expect(isRugbyListLine('11:40am Italy v South Africa (Main screen, with commentary)')).toBe(true);
    expect(isRugbyListLine('Kitchen times: 12pm to 7pm.')).toBe(false);
  });
});
