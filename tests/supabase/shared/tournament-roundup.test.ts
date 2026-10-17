import { describe, expect, it } from 'vitest';

import {
  coveredFixtureIds,
  coversFixture,
  expectedFixtureRevision,
  isRoundup,
} from '../../../supabase/functions/_shared/tournament-roundup';

const single = { source: 'tournament', tournament_fixture_id: 'f1', screening_revision: 3 };
const roundup = {
  source: 'tournament',
  tournament_fixture_id: 'f1',
  screening_revision: 3,
  roundup_fixture_ids: ['f1', 'f2', 'f3'],
  roundup_revisions: { f1: 3, f2: 5, f3: 2 },
};

describe('tournament post coverage', () => {
  it('reads a single-match post as covering its own fixture', () => {
    expect(coveredFixtureIds(single)).toEqual(['f1']);
    expect(isRoundup(single)).toBe(false);
    expect(coversFixture(single, 'f1')).toBe(true);
    expect(coversFixture(single, 'f2')).toBe(false);
  });

  it('reads a round-up as covering every listed game, lead first and without repeats', () => {
    expect(coveredFixtureIds(roundup)).toEqual(['f1', 'f2', 'f3']);
    expect(coveredFixtureIds({ ...roundup, roundup_fixture_ids: ['f2', 'f1', 'f2'] })).toEqual(['f1', 'f2']);
    expect(isRoundup(roundup)).toBe(true);
    expect(coversFixture(roundup, 'f3')).toBe(true);
  });

  it('ignores posts that are not tournament posts or carry malformed ids', () => {
    expect(coveredFixtureIds({ ...roundup, source: 'campaign' })).toEqual([]);
    expect(coveredFixtureIds(null)).toEqual([]);
    expect(coveredFixtureIds({ source: 'tournament', roundup_fixture_ids: [1, '', null, 'f9'] })).toEqual(['f9']);
  });

  it('returns the revision each game had at generation, or null when unknown', () => {
    expect(expectedFixtureRevision(single, 'f1')).toBe(3);
    expect(expectedFixtureRevision(roundup, 'f2')).toBe(5);
    expect(expectedFixtureRevision(roundup, 'f9')).toBeNull();
    expect(expectedFixtureRevision({ ...roundup, roundup_revisions: { f2: '5' } }, 'f2')).toBeNull();
  });
});
