import { describe, expect, it } from 'vitest';

import type { AiGenerationResponse } from './schemas';
import { postprocessCopy, type PostprocessConfig } from './postprocess';

function makeConfig(overrides?: Partial<PostprocessConfig>): PostprocessConfig {
  return {
    maxHashtags: { facebook: 5, instagram: 10, gbp: 3 },
    maxEmojis: { facebook: 3, instagram: 3, gbp: 2 },
    maxWords: { facebook: 300, instagram: 150, gbp: 750 },
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
    gbp: { body: 'Visit us today.', cta_action: 'LEARN_MORE' },
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

  it('enforces word limit (150 for Instagram, 300 for Facebook, 750 for GBP)', () => {
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

  it('warns when GBP CTA is null and no brand default (AI-08)', () => {
    const raw = makeRawCopy({
      gbp: { body: 'Visit us today.', cta_action: null },
    });
    const config = makeConfig({ defaultCta: null });
    const result = postprocessCopy(raw, config);
    expect(result.warnings).toContain(
      'GBP post has no call-to-action. Consider adding one for better engagement.',
    );
  });

  it('does not warn when GBP CTA is present', () => {
    const raw = makeRawCopy({
      gbp: { body: 'Visit us today.', cta_action: 'BOOK' },
    });
    const result = postprocessCopy(raw, makeConfig());
    const ctaWarnings = result.warnings.filter((w) => w.includes('call-to-action'));
    expect(ctaWarnings.length).toBe(0);
  });

  it('does not warn when defaultCta is set even if GBP CTA is null', () => {
    const raw = makeRawCopy({
      gbp: { body: 'Visit us today.', cta_action: null },
    });
    const config = makeConfig({ defaultCta: 'LEARN_MORE' });
    const result = postprocessCopy(raw, config);
    const ctaWarnings = result.warnings.filter((w) => w.includes('call-to-action'));
    expect(ctaWarnings.length).toBe(0);
  });
});
