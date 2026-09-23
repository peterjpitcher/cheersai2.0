import { describe, expect, it } from 'vitest';

import {
  applyAdUtmContent,
  buildAdUtmContentKey,
  normaliseCreativeFormat,
  uniqueAdUtmContentKey,
  utmContentMatchesAd,
} from '@/lib/campaigns/ad-attribution';

describe('ad attribution helpers', () => {
  it('builds stable compact utm_content keys and applies them to destinations', () => {
    const key = buildAdUtmContentKey({
      campaignName: 'Quiz Night',
      adSetName: 'Run-up | Local only',
      adName: 'Variation 1',
      angle: 'Booking urgency',
      creativeFormat: 'venue_photo',
    });

    expect(key).toBe('ad__quiz_night__run_up_local_only__venue_photo__booking_urgency__variation_1');
    expect(applyAdUtmContent('https://www.the-anchor.pub/events/quiz?utm_source=facebook', key))
      .toBe(`https://www.the-anchor.pub/events/quiz?utm_source=facebook&utm_content=${key}`);
    expect(utmContentMatchesAd(key.toUpperCase(), { utm_content_key: key })).toBe(true);
  });

  it('keeps a free key and suffixes a taken one without passing the length limit', () => {
    expect(uniqueAdUtmContentKey('ad__quiz__v1', ['ad__quiz__v2', null])).toBe('ad__quiz__v1');
    expect(uniqueAdUtmContentKey('ad__quiz__v1', ['AD__QUIZ__V1', 'ad__quiz__v1__2'])).toBe('ad__quiz__v1__3');

    const longKey = `ad__${'a'.repeat(156)}`;
    const unique = uniqueAdUtmContentKey(longKey, [longKey]);
    expect(unique).toHaveLength(160);
    expect(unique.endsWith('__2')).toBe(true);
    expect(unique).not.toBe(longKey);
  });

  it('normalises missing or invalid creative formats to the deterministic sequence', () => {
    expect(normaliseCreativeFormat('People Social')).toBe('people_social');
    expect(normaliseCreativeFormat('unknown', 2)).toBe('offer_graphic');
  });
});
