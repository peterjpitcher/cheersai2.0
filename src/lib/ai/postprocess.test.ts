import { describe, expect, it } from 'vitest';

import type { AiGenerationResponse } from './schemas';
import { postprocessCopy, removeBannedPhraseSentences, type PostprocessConfig } from './postprocess';

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

  it('replaces system clichés with natural alternatives instead of leaving broken sentences', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Bring your friends and family for a night to remember. Doors open at 6pm.',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    // "a night to remember" → "a great night" (BANNED_PHRASE_REPLACEMENTS), so
    // the sentence stays intact rather than becoming "…for. Doors open at 6pm."
    expect(result.copy.facebook.body).toContain('for a great night');
    expect(result.copy.facebook.body).toContain('Doors open at 6pm.');
    expect(result.copy.facebook.body).not.toMatch(/for\s*[.!]/);
  });

  it('removes the whole sentence for a banned phrase with no replacement', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'This place is a proper hidden gem for quiz lovers. Eyes down at 7pm.',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig({ bannedPhrases: ['hidden gem'] }));
    expect(result.copy.facebook.body).toBe('Eyes down at 7pm.');
  });

  it('matches banned phrases regardless of apostrophe style', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Don’t miss out on the fun. Doors open at 6pm.',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig({ bannedPhrases: ["Don't miss out"] }));
    expect(result.copy.facebook.body).toBe('Doors open at 6pm.');
  });

  it('keeps paragraph breaks when truncating over-length copy', () => {
    const para = Array.from({ length: 100 }, () => 'word').join(' ');
    const raw = makeRawCopy({
      instagram: { body: `First line stays.\n\n${para} ${para}`, hashtags: [], link_in_bio_line: null },
    });
    const result = postprocessCopy(raw, makeConfig());
    const wordCount = result.copy.instagram.body.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(150);
    expect(result.copy.instagram.body).toContain('\n\n');
  });

  it('clamps emoji by whole sequences without leaving orphaned joiners', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Party time \u{1F389}\u{1F37A}\u{1F355} bring the family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}!',
        cta_text: null,
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    expect(result.copy.facebook.body).not.toContain('\u200D');
    expect(result.copy.facebook.body).toContain('\u{1F389}');
  });

  it('strips a trailing bare "Book now!" sentence from a longer closing line (composer appends the linked CTA)', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Bring your friends and family for a great night. Book now!',
        cta_text: 'Book now',
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { facebook: 'https://l.the-anchor.pub/fb-event' },
    }));
    expect(result.copy.facebook.body).toBe('Bring your friends and family for a great night.');
  });

  it('strips a bare Instagram CTA when a link is configured but the model omitted the link-in-bio line', () => {
    const raw = makeRawCopy({
      instagram: {
        body: 'Live music this weekend.\n\nBook now!',
        hashtags: [],
        link_in_bio_line: null,
      },
    });
    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { instagram: 'https://l.the-anchor.pub/ig' },
    }));
    expect(result.copy.instagram.body).not.toMatch(/book now/i);
    expect(result.copy.instagram.body).toContain('Live music this weekend.');
  });

  it('strips a bare Facebook CTA that ends with a skin-tone emoji', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Great food and live music.\n\nReserve your table now \u{1F64C}\u{1F3FC}',
        cta_text: 'Book now',
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { facebook: 'https://l.the-anchor.pub/fb' },
    }));
    expect(result.copy.facebook.body).not.toMatch(/reserve your table now/i);
    expect(result.copy.facebook.body).toContain('Great food and live music.');
  });

  it('strips a trailing bare CTA even when a Facebook signature is configured', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Bring your crew for a great night. Book now!',
        cta_text: 'Book now',
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { facebook: 'https://l.the-anchor.pub/fb' },
      platformSignatures: { facebook: '-- The Anchor Team' },
    }));
    expect(result.copy.facebook.body).not.toMatch(/book now/i);
    expect(result.copy.facebook.body).toContain('-- The Anchor Team');
    expect(result.copy.facebook.body).toContain('Bring your crew for a great night.');
  });

  it('strips a bare booking CTA from the Instagram body when a link-in-bio line is present', () => {
    const raw = makeRawCopy({
      instagram: {
        body: 'Music Bingo is back this month.\n\nBook your spot now!',
        hashtags: [],
        link_in_bio_line: 'Link in bio to book.',
      },
    });
    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { instagram: 'https://vip-club.uk/bio-music-bingo' },
    }));
    expect(result.copy.instagram.body).not.toMatch(/book your spot now/i);
    expect(result.copy.instagram.body).toContain('Music Bingo is back this month.');
  });

  it('strips a bare "Book now!" CTA line from the Facebook body (composer adds the linked one)', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Join us Friday 17th July for a cracking night!\n\nBook now!',
        cta_text: 'Book now',
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { facebook: 'https://l.the-anchor.pub/fb-event' },
    }));
    expect(result.copy.facebook.body).not.toMatch(/book\s+now/i);
    expect(result.copy.facebook.body).toContain('Join us Friday 17th July for a cracking night!');
  });

  it('keeps the body CTA when nothing will replace it (no cta_text, no FB link)', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Come down Friday 17th July for live music from 8pm.\n\nBook now!',
        cta_text: null,
        hashtags: [],
      },
    });
    // No ctaLinks configured → composer would append no CTA, so the body CTA stays.
    const result = postprocessCopy(raw, makeConfig());
    expect(result.copy.facebook.body).toMatch(/book now/i);
  });

  it('does not strip short narrative imperatives like "Get comfy and grab a seat"', () => {
    const raw = makeRawCopy({
      facebook: {
        body: 'Two rounds of bingo tonight.\n\nGet comfy and grab a seat\n\nEyes down at 7.',
        cta_text: 'Book now',
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig({
      ctaLinks: { facebook: 'https://l.the-anchor.pub/fb-event' },
    }));
    expect(result.copy.facebook.body).toContain('Get comfy and grab a seat');
    expect(result.copy.facebook.body).toContain('Eyes down at 7.');
  });

  it('strips varied bare booking CTAs but keeps narrative booking mentions', () => {
    const raw = makeRawCopy({
      facebook: {
        body: [
          'Food is served from 4pm, so book your table early to grab a good spot before the fun begins.',
          '',
          'Reserve your spot now!',
        ].join('\n'),
        cta_text: 'Book now',
        hashtags: [],
      },
    });
    const result = postprocessCopy(raw, makeConfig());
    // Narrative sentence that mentions booking is preserved…
    expect(result.copy.facebook.body).toContain('book your table early');
    // …but the standalone imperative CTA line is removed.
    expect(result.copy.facebook.body).not.toMatch(/reserve your spot now/i);
  });

  describe('deterministic event-date normalisation', () => {
    const EVENT = '2026-07-17T20:00:00.000+01:00'; // Friday 17th July

    it('rewrites the abbreviated overlay-label leak "this FRI 17 JUL" to the absolute date', () => {
      const raw = makeRawCopy({
        facebook: {
          body: 'We’re excited for Music Bingo Night at The Anchor this FRI 17 JUL! Join us from 8pm.',
          cta_text: 'Book now',
          hashtags: [],
        },
      });
      const result = postprocessCopy(raw, makeConfig({ eventStartIso: EVENT }));
      expect(result.copy.facebook.body).toContain('Friday 17th July');
      expect(result.copy.facebook.body).not.toMatch(/FRI 17 JUL/i);
      expect(result.copy.facebook.body).not.toMatch(/\bthis FRI/i);
    });

    it('collapses "Next Friday, 17th July" to just the absolute date (no relative prefix, no duplicate)', () => {
      const raw = makeRawCopy({
        facebook: {
          body: 'Next Friday, 17th July at 8pm, we’re hosting Music Bingo Night.',
          cta_text: 'Book now',
          hashtags: [],
        },
      });
      const result = postprocessCopy(raw, makeConfig({ eventStartIso: EVENT }));
      expect(result.copy.facebook.body).toContain('Friday 17th July at 8pm');
      expect(result.copy.facebook.body).not.toMatch(/next friday/i);
      // no duplicated date
      expect((result.copy.facebook.body.match(/17th July/gi) ?? []).length).toBe(1);
    });

    it('replaces a bare "this Friday" referring to the event with the absolute date', () => {
      const raw = makeRawCopy({
        facebook: { body: 'Join us this Friday for a proper throwback night.', cta_text: 'Book now', hashtags: [] },
      });
      const result = postprocessCopy(raw, makeConfig({ eventStartIso: EVENT }));
      expect(result.copy.facebook.body).toContain('Join us Friday 17th July for');
      expect(result.copy.facebook.body).not.toMatch(/this friday/i);
    });

    it('adds the missing ordinal to "Friday 17 July"', () => {
      const raw = makeRawCopy({
        facebook: { body: 'See you on Friday 17 July from 8pm.', cta_text: 'Book now', hashtags: [] },
      });
      const result = postprocessCopy(raw, makeConfig({ eventStartIso: EVENT }));
      expect(result.copy.facebook.body).toContain('Friday 17th July');
    });

    it('is idempotent on already-correct "Friday 17th July"', () => {
      const raw = makeRawCopy({
        facebook: { body: 'Join us Friday 17th July from 8pm.', cta_text: 'Book now', hashtags: [] },
      });
      const result = postprocessCopy(raw, makeConfig({ eventStartIso: EVENT }));
      expect(result.copy.facebook.body).toBe('Join us Friday 17th July from 8pm.');
    });

    it('leaves unrelated weekday mentions ("every Friday") untouched', () => {
      const raw = makeRawCopy({
        facebook: { body: 'Our kitchen is open every Friday until late.', cta_text: 'Book now', hashtags: [] },
      });
      const result = postprocessCopy(raw, makeConfig({ eventStartIso: EVENT }));
      expect(result.copy.facebook.body).toContain('every Friday');
    });
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

describe('removeBannedPhraseSentences', () => {
  it('drops only the sentence containing the phrase and keeps the rest', () => {
    const result = removeBannedPhraseSentences(
      "Whether you're a regular or brand new, come along. Kitchen open till 9pm.",
      ["whether you're"],
    );
    expect(result).toBe('Kitchen open till 9pm.');
  });

  it('falls back to phrase-only deletion when sentence removal would empty the copy', () => {
    const result = removeBannedPhraseSentences('A proper hidden gem.', ['hidden gem']);
    expect(result).toBe('A proper.');
  });

  it('only matches whole words for single-word phrases', () => {
    const result = removeBannedPhraseSentences('A cart full of treats. Come see us.', ['art']);
    expect(result).toBe('A cart full of treats. Come see us.');
  });

  it('strips a banned phrase written with a curly apostrophe in the single-sentence fallback', () => {
    // Phrase stored with a straight apostrophe, model output uses a curly one.
    expect(removeBannedPhraseSentences('You won’t regret it.', ["you won't regret it"])).toBe('.');
  });
});
