import { describe, expect, it } from 'vitest';

import type { AiGenerationResponse } from './schemas';
import { postprocessCopy, type PostprocessConfig } from './postprocess';

function makeConfig(overrides?: Partial<PostprocessConfig>): PostprocessConfig {
  return {
    maxHashtags: { facebook: 5, instagram: 10 },
    maxEmojis: { facebook: 3, instagram: 3 },
    maxWords: { facebook: 300, instagram: 150 },
    bannedPhrases: ['Check out our amazing', 'Don\'t miss out', 'Act now'],
    platformSignatures: {},
    defaultCta: null,
    ...overrides,
  };
}

function makeRawCopy(overrides?: Partial<AiGenerationResponse>): AiGenerationResponse {
  return {
    facebook: { body: 'Join us for a great night.', cta_text: null, hashtags: ['#pub', '#food'] },
    instagram: { body: 'A lovely evening awaits.', hashtags: ['#pub'], link_in_bio_line: null },
    ...overrides,
  };
}

describe('postprocessCopy', () => {
  it('strips banned phrase "Check out our amazing" from Facebook body', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Check out our amazing menu tonight.',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    expect(result.copy.facebook.body).not.toContain('Check out our amazing');
    expect(result.copy.facebook.body.length).toBeGreaterThan(0);
  });

  it('clamps hashtags to max 10 for Instagram', () => {
    const raw = makeRawCopy({
      instagram: {
        body: 'Great food.',
        hashtags: Array.from({ length: 15 }, (_, i) => `#tag${i}`),
        link_in_bio_line: null,
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    expect(result.copy.instagram.hashtags!.length).toBeLessThanOrEqual(10);
  });

  it('normalises hashtags and strips body URLs before review', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Music Bingo is back.\nBook now: https://www.the-anchor.pub/book-table\n#OldTag',
        cta_text: 'Book now at https://www.the-anchor.pub/book-table',
        hashtags: ['MusicBingo', ' #RockAndPop', '@TheAnchor'],
      },
    });

    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { facebook: 'https://l.the-anchor.pub/fb-event' },
    }));

    expect(result.copy.facebook.body).toBe('Music Bingo is back.');
    expect(result.copy.facebook.cta_text).toBe('Book now');
    expect(result.copy.facebook.hashtags).toEqual(['#MusicBingo', '#RockAndPop', '#TheAnchor']);
  });

  it('clamps emoji count to max 3 per platform body', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Amazing night ahead! \u{1F389}\u{1F37A}\u{1F355}\u{1F525}\u{1F60D} Come join us!',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    const emojiCount = (result.copy.facebook.body.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    expect(emojiCount).toBeLessThanOrEqual(3);
  });

  it('cleans spacing artifacts left by emoji or phrase removal', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Bring your crew and let’s make it ! This will be a brilliant .',
        cta_text: null,
        hashtags: [],
      },
    });

    const result = postprocessCopy(raw, makeConfig());

    expect(result.copy.facebook.body).toBe('Bring your crew and let’s make it! This will be a brilliant.');
  });

  it('enforces word limit (150 for Instagram, 300 for Facebook)', () => {
    const longBody = Array.from({ length: 200 }, () => 'word').join(' ');
    const raw = makeRawCopy({
      instagram: { body: longBody, hashtags: [], link_in_bio_line: null },
    });
    const result = postprocessCopy(raw, makeConfig());
    const wordCount = result.copy.instagram.body.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(150);
  });

  it('appends platform signature when provided', () => {
    const config = makeConfig({
      platformSignatures: { facebook: '-- The Anchor Team' },
    });
    const raw = makeRawCopy();
    const result = postprocessCopy(raw, config);
    expect(result.copy.facebook.body).toContain('-- The Anchor Team');
  });

  it('strips markdown bold markers the platforms would show literally', () => {
    const raw = makeRawCopy({
      facebook: {
        body: '**Big news** tonight — get ready for tunes.',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    expect(result.copy.facebook.body).not.toContain('**');
    expect(result.copy.facebook.body).toContain('Big news tonight');
  });

  it('preserves paragraph breaks in the body', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Music Bingo is back.\n\nBring your mates and book your seats.',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    expect(result.copy.facebook.body).toContain('\n\n');
  });

  it('keeps Instagram booking links out of the body and link-in-bio line', () => {
    const raw = makeRawCopy({
      instagram: {
        body: [
          'Get ready for Music Bingo next Friday!',
          'Link in bio for bookings!',
          'Book now at the-anchor.pub/book-table',
        ].join('\n'),
        hashtags: ['#MusicBingo'],
        link_in_bio_line: 'Book now at the-anchor.pub/book-table',
      },
    });

    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { instagram: 'https://vip-club.uk/bio-music-bingo' },
    }));

    expect(result.copy.instagram.body).toContain('Get ready for Music Bingo next Friday!');
    expect(result.copy.instagram.body).not.toContain('Link in bio');
    expect(result.copy.instagram.body).not.toContain('the-anchor.pub');
    expect(result.copy.instagram.link_in_bio_line).toBe('Link in bio to book.');
  });
});
