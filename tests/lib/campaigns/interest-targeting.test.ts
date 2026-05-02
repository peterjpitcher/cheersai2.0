import { describe, expect, it, vi } from 'vitest';

import {
  applyInterestTargeting,
  normaliseAudienceKeywords,
  normaliseResolvedInterests,
  resolveMetaInterestsForKeywords,
} from '@/lib/campaigns/interest-targeting';

describe('interest targeting helpers', () => {
  it('normalises audience keywords and removes ID-like values', () => {
    expect(normaliseAudienceKeywords([
      ' Pub Quiz ',
      'pub quiz',
      '6003139266461',
      'id: 123',
      'Live   Music',
      '',
    ])).toEqual(['Pub Quiz', 'Live Music']);
  });

  it('resolves interests from Meta search results and caps at 3', async () => {
    const search = vi.fn(async (_token: string, query: string) => [
      {
        id: `id-${query}`,
        name: query,
        audience_size_lower_bound: 10_000,
      },
    ]);

    const result = await resolveMetaInterestsForKeywords(
      'token',
      ['pub quiz', 'live music', 'cocktails', 'private dining'],
      search,
    );

    expect(result.resolvedInterests).toHaveLength(3);
    expect(result.resolvedInterests.map((interest) => interest.id)).toEqual([
      'id-pub quiz',
      'id-live music',
      'id-cocktails',
    ]);
  });

  it('drops unresolved, duplicate, and tiny interests', async () => {
    const search = vi.fn(async (_token: string, query: string) => {
      if (query === 'tiny') {
        return [{ id: 'tiny-id', name: 'Tiny', audience_size_upper_bound: 50 }];
      }
      if (query === 'duplicate') {
        return [{ id: 'same-id', name: 'Duplicate', audience_size: 10_000 }];
      }
      if (query === 'duplicate again') {
        return [{ id: 'same-id', name: 'Duplicate Again', audience_size: 10_000 }];
      }
      return [];
    });

    const result = await resolveMetaInterestsForKeywords(
      'token',
      ['tiny', 'duplicate', 'duplicate again', 'missing'],
      search,
    );

    expect(result.resolvedInterests).toEqual([
      {
        id: 'same-id',
        name: 'Duplicate',
        path: undefined,
        description: null,
        audienceSize: 10000,
        audienceSizeLowerBound: null,
        audienceSizeUpperBound: null,
      },
    ]);
    expect(result.unresolvedKeywords).toEqual(['tiny', 'duplicate again', 'missing']);
  });

  it('adds interests to Meta flexible_spec without changing local geo', () => {
    const result = applyInterestTargeting(
      {
        age_min: 18,
        age_max: 65,
        geo_locations: { cities: [{ key: '811179', radius: 3, distance_unit: 'mile' }] },
      },
      [{ id: '6003139266461', name: 'Pub quiz' }],
    );

    expect(result).toEqual({
      age_min: 18,
      age_max: 65,
      geo_locations: { cities: [{ key: '811179', radius: 3, distance_unit: 'mile' }] },
      flexible_spec: [{ interests: [{ id: '6003139266461', name: 'Pub quiz' }] }],
    });
  });

  it('normalises resolved interests and caps at 3', () => {
    const interests = normaliseResolvedInterests([
      { id: '1', name: 'One' },
      { id: '2', name: 'Two' },
      { id: '2', name: 'Two Again' },
      { id: '3', name: 'Three' },
      { id: '4', name: 'Four' },
    ]);

    expect(interests.map((interest) => interest.id)).toEqual(['1', '2', '3']);
  });
});
