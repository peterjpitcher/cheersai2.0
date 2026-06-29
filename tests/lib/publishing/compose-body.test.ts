import { describe, it, expect } from 'vitest';
import { composePublishBody, buildPreviewData } from '@/lib/publishing/compose-body';

describe('composePublishBody', () => {
  describe('facebook', () => {
    it('appends CTA and hashtags to body', () => {
      const result = composePublishBody('facebook', {
        body: 'Join us tonight!',
        ctaText: 'Book your table now',
        hashtags: ['#PubNight', '#LiveMusic'],
      });
      expect(result).toBe('Join us tonight!\n\nBook your table now\n\n#PubNight #LiveMusic');
    });

    it('returns body alone when no extras', () => {
      const result = composePublishBody('facebook', { body: 'Simple post' });
      expect(result).toBe('Simple post');
    });

    it('appends the channel CTA URL when one is available', () => {
      const result = composePublishBody(
        'facebook',
        {
          body: 'Join us this Friday.',
          ctaText: 'Book now',
        },
        {
          ctaLinks: { facebook: 'https://vip-club.uk/fb-event' },
          contentType: 'event',
        },
      );

      expect(result).toBe('Join us this Friday.\n\nBook now: https://vip-club.uk/fb-event');
    });

    it('removes body URLs and body hashtags before appending the canonical CTA and hashtag block', () => {
      const result = composePublishBody(
        'facebook',
        {
          body: [
            'Music Bingo is back this Friday.',
            'Book now: https://www.the-anchor.pub/book-table',
            '#OldTag #MusicBingo',
          ].join('\n'),
          ctaText: 'Book now',
          hashtags: ['MusicBingo', ' #RockAndPop', '@TheAnchor'],
        },
        {
          ctaLinks: { facebook: 'https://l.the-anchor.pub/fb-event' },
          contentType: 'event',
        },
      );

      expect(result).toBe(
        'Music Bingo is back this Friday.\n\nBook now: https://l.the-anchor.pub/fb-event\n\n#MusicBingo #RockAndPop #TheAnchor',
      );
      expect(result).not.toContain('www.the-anchor.pub');
      expect(result).not.toContain('#OldTag');
    });

    it('uses a default event CTA label when the URL exists but generated copy omits CTA text', () => {
      const result = composePublishBody(
        'facebook',
        { body: 'Live music tomorrow night.' },
        {
          ctaLinks: { facebook: 'https://vip-club.uk/fb-music' },
          contentType: 'event',
        },
      );

      expect(result).toBe('Live music tomorrow night.\n\nBook now: https://vip-club.uk/fb-music');
    });

    it('handles empty hashtags array', () => {
      const result = composePublishBody('facebook', {
        body: 'Post with CTA only',
        ctaText: 'Click here',
        hashtags: [],
      });
      expect(result).toBe('Post with CTA only\n\nClick here');
    });

    it('trims whitespace from CTA', () => {
      const result = composePublishBody('facebook', {
        body: 'Post',
        ctaText: '  Book now  ',
      });
      expect(result).toBe('Post\n\nBook now');
    });

    it('uses the manually edited final publish body without appending structured extras', () => {
      const result = composePublishBody(
        'facebook',
        {
          body: 'Generated body',
          ctaText: 'Book now',
          hashtags: ['#Generated'],
          publishBodyOverride: 'Edited final body\n\nCustom CTA: https://example.com/book\n\n#Edited',
        },
        {
          ctaLinks: { facebook: 'https://canonical.example.com/book' },
          contentType: 'event',
        },
      );

      expect(result).toBe('Edited final body\n\nCustom CTA: https://example.com/book\n\n#Edited');
    });
  });

  describe('instagram', () => {
    it('appends link-in-bio and hashtags', () => {
      const result = composePublishBody('instagram', {
        body: 'New menu alert!',
        linkInBioLine: 'Link in bio for bookings',
        hashtags: ['#FoodPub', ' NewMenu'],
      });
      expect(result).toBe('New menu alert!\n\nLink in bio for bookings\n\n#FoodPub #NewMenu');
    });

    it('returns body alone when no extras', () => {
      const result = composePublishBody('instagram', { body: 'Simple IG post' });
      expect(result).toBe('Simple IG post');
    });

    it('adds link-in-bio wording without exposing the destination URL', () => {
      const result = composePublishBody(
        'instagram',
        { body: 'Quiz night is back.' },
        {
          ctaLinks: { instagram: 'https://vip-club.uk/bio-quiz' },
          contentType: 'event',
        },
      );

      expect(result).toBe('Quiz night is back.\n\nLink in bio to book');
      expect(result).not.toContain('https://vip-club.uk/bio-quiz');
    });

    it('removes hashtags from the Instagram body before appending normalised hashtags', () => {
      const result = composePublishBody('instagram', {
        body: 'Music Bingo is back.\n\n#MusicBingo #OldTag',
        linkInBioLine: 'Link in bio to reserve your table',
        hashtags: ['MusicBingo', 'StanwellMoor'],
      });

      expect(result).toBe(
        'Music Bingo is back.\n\nLink in bio to reserve your table\n\n#MusicBingo #StanwellMoor',
      );
      expect(result).not.toContain('#OldTag');
    });

    it('strips manually entered direct booking domains from Instagram bodies', () => {
      const result = composePublishBody(
        'instagram',
        {
          body: 'Quiz night is back. Book now at the-anchor.pub/book-table',
          linkInBioLine: 'Link in bio to book',
        },
      );

      expect(result).toBe('Quiz night is back.\n\nLink in bio to book');
      expect(result).not.toContain('the-anchor.pub');
      expect(result).not.toContain('Book now at');
    });
  });
});

describe('buildPreviewData', () => {
  it('stores structured copy and platform', () => {
    const copy = { body: 'Test', hashtags: ['#test'] };
    const result = buildPreviewData('facebook', copy);
    expect(result).toMatchObject({
      structuredCopy: copy,
      platform: 'facebook',
    });
  });

  it('includes slot context when provided', () => {
    const copy = { body: 'Test' };
    const result = buildPreviewData('instagram', copy, {
      slotLabel: 'Event day',
      slotKey: 'slot-1',
      brief: { title: 'Quiz Night' },
    });
    expect(result).toMatchObject({
      structuredCopy: copy,
      platform: 'instagram',
      slotLabel: 'Event day',
      slotKey: 'slot-1',
      brief: { title: 'Quiz Night' },
    });
  });

  it('stores CTA metadata for publish adapters', () => {
    const result = buildPreviewData(
      'facebook',
      { body: 'Book for live jazz.', ctaText: 'Book now' },
      undefined,
      {
        ctaLinks: { facebook: 'https://vip-club.uk/fb-live-jazz' },
        contentType: 'event',
      },
    );

    expect(result).toMatchObject({
      ctaUrl: 'https://vip-club.uk/fb-live-jazz',
    });
  });
});
