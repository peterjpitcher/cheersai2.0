import { NATIONS_TEMPLATE_VERSION } from '../../../supabase/functions/_shared/nations-content-contract';
import { describe, expect, it } from 'vitest';
import type { ScreeningDayHours } from '@/lib/management-app/screening-hours';
import type { TournamentFixture } from '@/types/tournament';
import { lintContent } from '@/lib/ai/content-rules';
import { buildTournamentContentPayload } from './generate';
import { resolveScreening, toScreeningFacts } from './screening';
import type { ScreenedFixture } from './screening-service';

const tournament = { id: 't', houseRulesText: 'Outdated all games claim', postTemplate: 'We open early', updatedAt: 'version-1' };
const fixture = { id: 'f', teamA: 'Italy', teamB: 'South Africa', kickOffAt: '2026-11-07T11:40:00Z', round: 'league_round' as const, groupName: null, bookingUrl: null };

function screenedFor({
  kickOffAt = fixture.kickOffAt,
  kitchen = [['12:00', '19:00']],
  kitchenState = 'known',
  policy,
  screenLabel = 'Main screen',
  commentary = 'on',
}: {
  kickOffAt?: string;
  kitchen?: Array<[string, string]>;
  kitchenState?: 'known' | 'unknown';
  policy?: 'stay_open_if_viewers';
  screenLabel?: string | null;
  commentary?: 'on' | 'off' | 'unconfirmed';
} = {}): ScreenedFixture {
  const date = kickOffAt.slice(0, 10);
  const game = {
    ...fixture, kickOffAt, showing: true, teamsConfirmed: true, screeningDecision: 'unconfirmed', broadcastDecision: 'confirmed',
    broadcastCheckedAt: '2026-09-05T09:00:00Z', screeningConfirmedAt: '2026-09-05T09:00:00Z', contentRevision: 2, screenLabel, commentary,
  } as TournamentFixture;
  const facts = toScreeningFacts(game, 'rugby_union');
  const hours: ScreeningDayHours = {
    date, state: 'open', regularOpensAt: `${date}T12:00:00Z`,
    bar: { startAt: `${date}T12:00:00Z`, endAt: `${date}T22:00:00Z` },
    kitchen: kitchen.map(([start, end]) => ({ startAt: `${date}T${start}:00Z`, endAt: `${date}T${end}:00Z` })),
    kitchenState, hasSpecialHours: false, fingerprint: 'fp',
  };
  return { ...facts, hours, screening: resolveScreening(facts, hours, new Date('2026-09-05T09:00:00Z'), policy) };
}

describe('rugby social copy from screening facts', () => {
  it.each(['feed', 'story'] as const)('includes food and an honest opening time for %s', placement => {
    const screened = screenedFor();
    const result = buildTournamentContentPayload({ tournament, fixture, screened, platform: 'facebook', placement, scheduledFor: new Date('2026-11-06T11:40:00Z') });
    const preview = placement === 'story' ? String(result.promptContext.screening_caption) : result.body;
    expect(preview).toContain("We open at 12pm, 20 minutes after kick-off, so you'll catch the rest of the game.");
    expect(preview).toContain('Kitchen times: 12pm to 7pm, so you can eat while you watch.');
    expect(preview).toContain('Showing on: Main screen, with commentary.');
    expect(result.body).not.toContain('open early');
    expect(result.promptContext.ctaUrl).toContain('#fixture-f');
    expect(result.promptContext.screening_template_version).toBe(NATIONS_TEMPLATE_VERSION);
    expect(result.promptContext.booking_url).toBe('https://www.the-anchor.pub/book-table?fixture_id=f&date=2026-11-07');
    expect(result.promptContext.screening_revision).toBe(2);
    expect(result.promptContext.screening_hours_fingerprint).toBe('fp');
  });

  it('writes the Facebook feed post as paragraphs with one menu line and one booking line', () => {
    const result = buildTournamentContentPayload({ tournament, fixture, screened: screenedFor(), platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-04T11:40:00Z') });
    const paragraphs = result.body.split('\n\n');
    expect(paragraphs[0]).toMatch(/Italy v South Africa/);
    expect(paragraphs[0]).toContain('Saturday 7th November');
    expect(paragraphs[0]).toContain('11:40am');
    expect(paragraphs.at(-2)).toBe('See our menu: https://www.the-anchor.pub/food-menu');
    expect(paragraphs.at(-1)).toBe('Book a table: https://www.the-anchor.pub/live-sport/nations-championship#fixture-f');
    expect(result.body.match(/Book a table/g)).toHaveLength(1);
    expect(result.body).not.toMatch(/\b\d{2}:\d{2}\b/);
    expect(result.body).not.toMatch(/start missed|may be missed/);
  });

  it('points Instagram to the link in bio without any address', () => {
    const result = buildTournamentContentPayload({ tournament, fixture, screened: screenedFor(), platform: 'instagram', placement: 'feed', scheduledFor: new Date('2026-11-04T11:40:00Z') });
    expect(result.body).not.toMatch(/https?:|www\.|menu:/i);
    expect(result.body.split('\n\n').at(-1)).toBe('Book a table via the link in our bio.');
  });
});

it('preserves campaign attribution on approved destinations', () => {
 const result = buildTournamentContentPayload({ tournament, fixture: { ...fixture, bookingUrl: 'https://www.the-anchor.pub/book-table?utm_source=facebook&utm_campaign=rugby' }, screened: screenedFor(), platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') });
 expect(result.promptContext.ctaUrl).toBe('https://www.the-anchor.pub/live-sport/nations-championship?utm_source=facebook&utm_campaign=rugby#fixture-f');
 expect(result.promptContext.booking_url).toContain('utm_source=facebook&utm_campaign=rugby&fixture_id=f&date=2026-11-07');
});
it.each(['javascript:alert(1)', 'https://unapproved.example/book-table', 'https://www.the-anchor.pub/book-table?redirect=https://unapproved.example', 'https://user:password@www.the-anchor.pub/book-table'])('rejects unapproved generation links: %s', bookingUrl => {
 expect(() => buildTournamentContentPayload({ tournament, fixture: { ...fixture, bookingUrl }, screened: screenedFor(), platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') })).toThrow();
});

it.each(['facebook', 'instagram'] as const)('keeps split kitchen details after final %s channel rules', platform => {
 const result = buildTournamentContentPayload({ tournament, fixture, screened: screenedFor({ kitchen: [['12:00', '14:00'], ['17:00', '19:00']] }), platform, placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') });
 expect(result.body).toContain('Kitchen times: 12pm to 2pm and 5pm to 7pm, so you can eat while you watch.');
 expect(result.body).toContain("We open at 12pm, 20 minutes after kick-off, so you'll catch the rest of the game.");
});
it('blocks a feed if final channel shortening removes kitchen qualification', () => {
 // Thirty one-minute kitchen windows make the kitchen sentence longer than
 // Instagram's word limit, so channel shortening would cut it.
 const manyWindows = Array.from({ length: 30 }, (_, index) =>
   [`12:${String(index * 2).padStart(2, '0')}`, `12:${String(index * 2 + 1).padStart(2, '0')}`] as [string, string]);
 expect(() => buildTournamentContentPayload({ tournament, fixture, screened: screenedFor({ kitchen: manyWindows }), platform: 'instagram', placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') })).toThrow('shortened');
});

it('leaves out the kitchen line when kitchen times are unknown', () => {
  const result = buildTournamentContentPayload({ tournament, fixture, screened: screenedFor({ kitchenState: 'unknown', kitchen: [] }), platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') });
  expect(result.body).not.toMatch(/Kitchen|menu:/);
});

it.each([
  ['facebook', 'feed'], ['facebook', 'story'],
  ['instagram', 'feed'], ['instagram', 'story'],
] as const)('retains conditional late opening and kitchen limits for %s %s', (platform, placement) => {
  const result = buildTournamentContentPayload({
    tournament, fixture: { ...fixture, kickOffAt: '2026-11-06T20:10:00Z' },
    screened: screenedFor({ kickOffAt: '2026-11-06T20:10:00Z', kitchen: [['12:00', '15:00'], ['16:00', '21:00']], policy: 'stay_open_if_viewers', screenLabel: null, commentary: 'unconfirmed' }),
    platform, placement,
    scheduledFor: new Date('2026-11-03T20:10:00Z'),
  });
  const copy = placement === 'story' ? String(result.promptContext.screening_caption) : result.body;
  expect(copy).toContain("We usually close at 10pm. If you're still here watching, we'll stay open until the final whistle. Please arrive before 10pm.");
  expect(copy).toContain('Kitchen times: 12pm to 3pm and 4pm to 9pm, so you can eat while you watch.');
  expect(copy).not.toContain('end of the match may be missed');
  expect(result.promptContext.screening_template_version).toBe(NATIONS_TEMPLATE_VERSION);
});

it('is honest that another brand closes before the final whistle', () => {
  const result = buildTournamentContentPayload({
    tournament, fixture: { ...fixture, kickOffAt: '2026-11-06T20:10:00Z' },
    screened: screenedFor({ kickOffAt: '2026-11-06T20:10:00Z', kitchen: [['12:00', '19:00']] }),
    platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-03T20:10:00Z'),
  });
  expect(result.body).toContain('We close at 10pm, before the final whistle, so you may miss the end.');
  expect(result.body).toContain('Kitchen times: 12pm to 7pm, so you can eat before kick-off.');
  expect(result.body).not.toContain('stay open');
});

describe('match-day round-up posts', () => {
  const games = [
    { id: 'f', teamA: 'Italy', teamB: 'South Africa', kickOffAt: '2026-11-07T11:40:00Z' },
    { id: 'g', teamA: 'Scotland', teamB: 'New Zealand', kickOffAt: '2026-11-07T14:10:00Z' },
    { id: 'h', teamA: 'Wales', teamB: 'Japan', kickOffAt: '2026-11-07T16:40:00Z' },
    { id: 'i', teamA: 'France', teamB: 'Fiji', kickOffAt: '2026-11-07T20:10:00Z' },
  ];
  const roundup = games.map((game, index) => ({
    ...screenedFor({ kickOffAt: game.kickOffAt, policy: 'stay_open_if_viewers', screenLabel: null, commentary: 'unconfirmed' }),
    id: game.id, teamA: game.teamA, teamB: game.teamB, contentRevision: 2 + index,
  }));

  it('records every game it covers and the revision each was written from', () => {
    const result = buildTournamentContentPayload({ tournament, fixture, screened: roundup[0], roundup, platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-04T11:40:00Z') });
    expect(result.promptContext.tournament_fixture_id).toBe('f');
    expect(result.promptContext.roundup_fixture_ids).toEqual(['f', 'g', 'h', 'i']);
    expect(result.promptContext.roundup_revisions).toEqual({ f: 2, g: 3, h: 4, i: 5 });
    expect(result.promptContext.title).toBe('Rugby on Saturday 7th November');
    expect(result.promptContext.ctaUrl).toContain('#fixture-f');
  });

  it('writes the games as a tight list with one booking line', () => {
    const result = buildTournamentContentPayload({ tournament, fixture, screened: roundup[0], roundup, platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-04T11:40:00Z') });
    expect(result.body).toContain('11:40am Italy v South Africa\n2:10pm Scotland v New Zealand\n4:40pm Wales v Japan\n8:10pm France v Fiji');
    expect(result.body).toContain("If you're still here watching the 8:10pm game, we'll stay open until the final whistle.");
    expect(result.body.match(/Book a table/g)).toHaveLength(1);
    expect(result.body).not.toMatch(/\b\d{2}:\d{2}\b/);
  });

  it('keeps a long Instagram round-up whole and passes the publishing checks', () => {
    const scheduledFor = new Date('2026-11-04T11:40:00Z');
    const result = buildTournamentContentPayload({ tournament, fixture, screened: roundup[0], roundup, platform: 'instagram', placement: 'feed', scheduledFor });
    expect(result.body.split(/\s+/).length).toBeGreaterThan(80);
    expect(result.body).toContain('Kitchen times: 12pm to 7pm, so you can eat while you watch.');
    expect(result.body.split('\n\n').at(-1)).toBe('Book a table via the link in our bio.');
    expect(lintContent({ body: result.body, platform: 'instagram', placement: 'feed', context: result.promptContext, scheduledFor }).pass).toBe(true);
  });

  it('treats a single game as a normal match post', () => {
    const result = buildTournamentContentPayload({ tournament, fixture, screened: roundup[0], roundup: [roundup[0]], platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-04T11:40:00Z') });
    expect(result.promptContext.roundup_fixture_ids).toBeUndefined();
    expect(result.body).toMatch(/Italy v South Africa/);
  });
});
