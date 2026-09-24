import { describe, expect, it } from 'vitest';

import { slugSchema, suggestSlug } from '@/lib/link-in-bio/validation';

describe('suggestSlug', () => {
  it.each([
    ['The Crown & Anchor', 'the-crown-anchor'],
    ['  Café Rouge  ', 'cafe-rouge'],
    ['Orange Jelly', 'orange-jelly'],
    ['A', ''],
    [null, ''],
    ['', ''],
  ])('%s -> %s', (name, expected) => {
    expect(suggestSlug(name)).toBe(expected);
  });

  it('never exceeds the slug limit or ends with a hyphen', () => {
    const slug = suggestSlug('The Very Long Name Of A Village Pub And Kitchen With Rooms');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });
});
