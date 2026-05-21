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
  });

  describe('instagram', () => {
    it('appends link-in-bio and hashtags', () => {
      const result = composePublishBody('instagram', {
        body: 'New menu alert!',
        linkInBioLine: 'Link in bio for bookings',
        hashtags: ['#FoodPub', '#NewMenu'],
      });
      expect(result).toBe('New menu alert!\n\nLink in bio for bookings\n\n#FoodPub #NewMenu');
    });

    it('returns body alone when no extras', () => {
      const result = composePublishBody('instagram', { body: 'Simple IG post' });
      expect(result).toBe('Simple IG post');
    });
  });

  describe('gbp', () => {
    it('returns body only -- CTA is an API field, not body text', () => {
      const result = composePublishBody('gbp', {
        body: 'We are open for business.',
        ctaAction: 'BOOK',
      });
      expect(result).toBe('We are open for business.');
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
});
