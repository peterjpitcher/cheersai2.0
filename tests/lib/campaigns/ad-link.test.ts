import { describe, expect, it } from 'vitest';

import { resolveAdLinkUrl } from '@/lib/campaigns/ad-link';

const key = 'ad__quiz_night__run_up__venue_photo__booking_intent__variation_1';

const snapshotWithVariant = {
  managementMetaAdVariants: [{
    shortUrl: 'https://l.the-anchor.pub/var01',
    shortCode: 'var01',
    destinationUrl: 'https://www.the-anchor.pub/events/quiz?utm_content=meta_ads_main',
    utmDestinationUrl: `https://www.the-anchor.pub/events/quiz?utm_content=${key}`,
    utmContent: key,
    parentShortCode: 'quiz',
  }],
  serviceBookingUrls: { weekday_dinner: 'https://www.the-anchor.pub/book-table?service=dinner' },
};

describe('resolveAdLinkUrl', () => {
  it('sends a food booking ad to its service booking page with the ad key', () => {
    expect(resolveAdLinkUrl({
      campaignKind: 'food_booking',
      destinationUrl: 'https://l.the-anchor.pub/quiz',
      sourceSnapshot: snapshotWithVariant,
      serviceKey: 'weekday_dinner',
      utmContentKey: key,
    })).toBe(`https://www.the-anchor.pub/book-table?service=dinner&utm_content=${key}`);
  });

  it('uses the ad key short link when the campaign is not food booking', () => {
    expect(resolveAdLinkUrl({
      campaignKind: 'event',
      destinationUrl: 'https://l.the-anchor.pub/quiz',
      sourceSnapshot: snapshotWithVariant,
      serviceKey: 'weekday_dinner',
      utmContentKey: key.toUpperCase(),
    })).toBe('https://l.the-anchor.pub/var01');
  });

  it('falls back to the campaign link with utm_content when the ad has no short link', () => {
    expect(resolveAdLinkUrl({
      campaignKind: 'evergreen',
      destinationUrl: 'https://www.the-anchor.pub/book-table?utm_source=facebook',
      sourceSnapshot: null,
      utmContentKey: key,
    })).toBe(`https://www.the-anchor.pub/book-table?utm_source=facebook&utm_content=${key}`);
  });
});
