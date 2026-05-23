import { describe, expect, it } from 'vitest';

import { fixtureUpdateSchema } from './validation';

const baseFixtureUpdate = {
  teamA: 'England',
  teamB: 'Scotland',
  teamsConfirmed: true,
  showing: true,
  showingNote: null,
  bookingUrl: '',
  kickOffAt: '2026-06-14T19:00:00.000Z',
};

describe('fixtureUpdateSchema', () => {
  it('accepts editable fixture metadata from the edit modal', () => {
    const result = fixtureUpdateSchema.parse({
      ...baseFixtureUpdate,
      matchNumber: 12,
      round: 'round_of_16',
      groupName: 'Group B',
      venueCity: 'London',
    });

    expect(result.matchNumber).toBe(12);
    expect(result.round).toBe('round_of_16');
    expect(result.groupName).toBe('Group B');
    expect(result.venueCity).toBe('London');
  });

  it('keeps inline team edits valid without optional metadata', () => {
    expect(() => fixtureUpdateSchema.parse(baseFixtureUpdate)).not.toThrow();
  });

  it('accepts Supabase timestamp offsets from existing fixture rows', () => {
    expect(() =>
      fixtureUpdateSchema.parse({
        ...baseFixtureUpdate,
        kickOffAt: '2026-06-11T19:00:00+00:00',
      }),
    ).not.toThrow();
  });

  it('rejects duplicate-prone or invalid match numbers before hitting the database', () => {
    expect(() =>
      fixtureUpdateSchema.parse({
        ...baseFixtureUpdate,
        matchNumber: 0,
      }),
    ).toThrow();
  });
});
