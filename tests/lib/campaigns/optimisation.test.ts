import { describe, expect, it } from 'vitest';

import {
  buildBlendedBookingSignals,
  evaluateAdSetOptimisation,
  evaluateCampaignOptimisation,
  type BookingConversionEventForOptimisation,
  type OptimisationAdRow,
  type OptimisationAdSetRow,
  type OptimisationCampaignRow,
} from '@/lib/campaigns/optimisation';

const syncedAt = new Date().toISOString();

function ad(overrides: Partial<OptimisationAdRow>): OptimisationAdRow {
  return {
    id: 'ad-1',
    meta_ad_id: 'meta-ad-1',
    name: 'Ad 1',
    headline: 'Book quiz seats',
    primary_text: 'Book quiz seats before they go.',
    description: 'Book now',
    cta: 'BOOK_NOW',
    angle: 'Booking intent',
    status: 'ACTIVE',
    meta_status: 'ACTIVE',
    metrics_spend: 0,
    metrics_impressions: 0,
    metrics_clicks: 0,
    metrics_ctr: 0,
    metrics_cpc: 0,
    metrics_conversions: 0,
    metrics_cost_per_conversion: 0,
    metrics_conversion_rate: 0,
    last_synced_at: syncedAt,
    ...overrides,
  };
}

function adSet(overrides: Partial<OptimisationAdSetRow>): OptimisationAdSetRow {
  return {
    id: 'adset-1',
    meta_adset_id: 'meta-adset-1',
    name: 'Run-up | Local only',
    status: 'ACTIVE',
    meta_status: 'ACTIVE',
    last_synced_at: syncedAt,
    ads: [],
    ...overrides,
  };
}

function campaign(overrides: Partial<OptimisationCampaignRow>): OptimisationCampaignRow {
  return {
    id: 'campaign-1',
    account_id: 'account-1',
    meta_campaign_id: 'meta-campaign-1',
    name: 'Quiz Night',
    destination_url: 'https://www.the-anchor.pub/events/quiz-night',
    source_snapshot: { bookingConversionOptimised: true },
    status: 'ACTIVE',
    meta_status: 'ACTIVE',
    last_synced_at: syncedAt,
    ad_sets: [],
    ...overrides,
  };
}

describe('campaign optimisation rules', () => {
  it('pauses a losing ad with no bookings when a sibling has bookings', () => {
    const decisions = evaluateAdSetOptimisation(
      campaign({}),
      adSet({}),
      [
        ad({ id: 'winner', meta_ad_id: 'meta-winner', metrics_conversions: 1, metrics_spend: 4 }),
        ad({ id: 'loser', meta_ad_id: 'meta-loser', metrics_conversions: 0, metrics_spend: 5 }),
      ],
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      adId: 'loser',
      metaObjectId: 'meta-loser',
      actionType: 'pause_ad',
    });
  });

  it('pauses at most one clear loser when no ads have bookings', () => {
    const decisions = evaluateAdSetOptimisation(
      campaign({}),
      adSet({}),
      [
        ad({ id: 'strong', meta_ad_id: 'meta-strong', metrics_impressions: 700, metrics_clicks: 12, metrics_ctr: 1.8, metrics_spend: 6 }),
        ad({ id: 'weak', meta_ad_id: 'meta-weak', metrics_impressions: 900, metrics_clicks: 2, metrics_ctr: 0.2, metrics_spend: 4 }),
        ad({ id: 'also-weak', meta_ad_id: 'meta-also-weak', metrics_impressions: 850, metrics_clicks: 3, metrics_ctr: 0.3, metrics_spend: 5 }),
      ],
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.adId).toBe('weak');
  });

  it('does not evaluate inactive, unsynced, or single-ad ad sets', () => {
    const { decisions, evaluatedAdSets } = evaluateCampaignOptimisation([
      campaign({
        ad_sets: [
          adSet({
            ads: [
              ad({ id: 'only', metrics_spend: 10, metrics_clicks: 0 }),
            ],
          }),
          adSet({
            id: 'unsynced',
            last_synced_at: null,
            ads: [
              ad({ id: 'winner', metrics_conversions: 1 }),
              ad({ id: 'loser', metrics_spend: 8 }),
            ],
          }),
          adSet({
            id: 'paused',
            status: 'PAUSED',
            ads: [
              ad({ id: 'winner-2', metrics_conversions: 1 }),
              ad({ id: 'loser-2', metrics_spend: 8 }),
            ],
          }),
        ],
      }),
    ]);

    expect(evaluatedAdSets).toBe(0);
    expect(decisions).toEqual([]);
  });

  it('does not create recommendations for finished campaigns', () => {
    const { decisions, evaluatedAdSets } = evaluateCampaignOptimisation([
      campaign({
        end_date: '2000-01-01',
        metrics_clicks: 20,
        metrics_spend: 20,
        ad_sets: [
          adSet({
            ads: [
              ad({ id: 'winner', metrics_conversions: 1 }),
              ad({ id: 'loser', metrics_spend: 12, metrics_clicks: 20 }),
            ],
          }),
        ],
      }),
    ]);

    expect(evaluatedAdSets).toBe(0);
    expect(decisions).toEqual([]);
  });

  it('never plans to pause the final active ad in an ad set', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        ad_sets: [
          adSet({
            ads: [
              ad({ id: 'winner', metrics_conversions: 1, status: 'PAUSED', meta_status: 'PAUSED' }),
              ad({ id: 'loser', metrics_spend: 8 }),
            ],
          }),
        ],
      }),
    ]);

    expect(decisions).toEqual([]);
  });
});

describe('blended booking signals', () => {
  const bookingEvent: BookingConversionEventForOptimisation = {
    booking_id: 'booking-1',
    booking_type: 'event',
    event_id: 'event-1',
    event_slug: 'quiz-night',
    utm_campaign: null,
    utm_content: null,
    fbclid: 'fb-1',
    gclid: null,
    short_code: null,
    occurred_at: syncedAt,
  };

  it('uses Meta bookings when Meta has conversions', () => {
    const signals = buildBlendedBookingSignals([
      campaign({ metrics_conversions: 2, source_id: 'other-event' }),
    ], []);

    expect(signals.get('campaign-1')).toMatchObject({
      metaBookings: 2,
      firstPartyBookings: 0,
      blendedBookings: 2,
      trackingMismatch: false,
    });
  });

  it('uses first-party bookings when campaign event ids match', () => {
    const signals = buildBlendedBookingSignals([
      campaign({ source_id: 'event-1', metrics_conversions: 0 }),
    ], [bookingEvent]);

    expect(signals.get('campaign-1')).toMatchObject({
      metaBookings: 0,
      firstPartyBookings: 1,
      blendedBookings: 1,
      trackingMismatch: true,
    });
  });

  it('uses first-party bookings when campaign short codes match', () => {
    const signals = buildBlendedBookingSignals([
      campaign({
        destination_url: 'https://l.the-anchor.pub/ma83ed9d',
        source_id: 'other-event',
        metrics_conversions: 0,
      }),
    ], [{
      ...bookingEvent,
      event_id: null,
      event_slug: null,
      short_code: 'MA83ED9D',
    }]);

    expect(signals.get('campaign-1')).toMatchObject({
      metaBookings: 0,
      firstPartyBookings: 1,
      blendedBookings: 1,
      trackingMismatch: true,
    });
  });

  it('keeps the stronger blended booking count when both sources agree', () => {
    const signals = buildBlendedBookingSignals([
      campaign({ source_id: 'event-1', metrics_conversions: 1 }),
    ], [bookingEvent]);

    expect(signals.get('campaign-1')).toMatchObject({
      metaBookings: 1,
      firstPartyBookings: 1,
      blendedBookings: 1,
      trackingMismatch: false,
    });
  });

  it('classifies Meta zero with first-party bookings as a tracking mismatch', () => {
    const campaignRow = campaign({ source_id: 'event-1', metrics_conversions: 0 });
    const bookingSignals = buildBlendedBookingSignals([campaignRow], [bookingEvent]);
    const { decisions } = evaluateCampaignOptimisation([campaignRow], { bookingSignals });

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionType: 'tracking_issue',
        recommendationPayload: expect.objectContaining({ category: 'meta_first_party_mismatch' }),
      }),
    ]));
  });
});

describe('copy recommendations', () => {
  it('creates copy rewrite recommendations for clicks with no blended bookings', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        metrics_clicks: 12,
        metrics_spend: 7,
        metrics_conversions: 0,
        ad_sets: [
          adSet({
            ads: [
              ad({
                id: 'weak-copy',
                meta_ad_id: 'meta-weak-copy',
                headline: 'Quiz night',
                primary_text: 'A brilliant evening is coming soon.',
                description: 'Learn more',
                cta: 'LEARN_MORE',
                angle: 'Generic',
                metrics_clicks: 6,
                metrics_spend: 4,
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(decisions.some((decision) => decision.actionType === 'copy_rewrite')).toBe(true);
  });

  it('keeps internal date formats and generic fallback wording out of copy rewrites', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        campaign_kind: 'event',
        name: 'Gavin & Stacy Quiz Night 2026',
        problem_brief: 'Gavin & Stacy Quiz Night on 2026-05-15 Reserve your spot now so the table, tickets, or seats are sorted before the day.',
        source_snapshot: {
          bookingConversionOptimised: true,
          eventName: 'Gavin & Stacy Quiz Night 2026',
          eventDate: '2026-05-15',
          eventTime: '19:45',
          paymentMode: 'cash_only',
          pricePerSeat: 3,
        },
        metrics_clicks: 12,
        metrics_spend: 7,
        metrics_conversions: 0,
        ad_sets: [
          adSet({
            ads: [
              ad({
                id: 'weak-copy',
                headline: 'Quiz starts soon',
                primary_text: 'A brilliant evening is coming soon.',
                description: 'Learn more',
                cta: 'LEARN_MORE',
                angle: 'Generic',
                metrics_clicks: 6,
                metrics_spend: 4,
              }),
            ],
          }),
        ],
      }),
    ]);

    const rewrite = decisions.find((decision) => decision.actionType === 'copy_rewrite');
    const proposed = rewrite?.recommendationPayload.proposed as { primaryText: string; cta: string } | undefined;

    expect(proposed?.primaryText).toContain('Friday 15 May');
    expect(proposed?.primaryText).toContain('£3 per person, starts at 7:45pm.');
    expect(proposed?.primaryText).toContain('No payment now, pay £3 on arrival.');
    expect(proposed?.primaryText).not.toContain('2026-05-15');
    expect(proposed?.primaryText).not.toContain('table, tickets, or seats');
    expect(proposed?.cta).toBe('BOOK_NOW');
  });

  it('does not rewrite copy when first-party bookings exist', () => {
    const campaignRow = campaign({
      source_id: 'event-1',
      metrics_clicks: 12,
      metrics_spend: 7,
      metrics_conversions: 0,
      ad_sets: [
        adSet({
          ads: [
            ad({ id: 'ad-with-bookings', metrics_clicks: 8, metrics_spend: 4 }),
          ],
        }),
      ],
    });
    const bookingSignals = buildBlendedBookingSignals([campaignRow], [{
      booking_id: 'booking-1',
      booking_type: 'event',
      event_id: 'event-1',
      event_slug: null,
      utm_campaign: null,
      utm_content: null,
      fbclid: null,
      gclid: null,
      short_code: null,
      occurred_at: syncedAt,
    }]);

    const { decisions } = evaluateCampaignOptimisation([campaignRow], { bookingSignals });

    expect(decisions.some((decision) => decision.actionType === 'copy_rewrite')).toBe(false);
  });

  it('still recommends rewriting dangerous date or CTA mismatches even when bookings exist', () => {
    const campaignRow = campaign({
      campaign_kind: 'event',
      source_id: 'event-1',
      source_snapshot: {
        eventId: 'event-1',
        eventName: 'Music Bingo',
        eventDate: '2026-05-08T20:00:00+01:00',
        paymentMode: 'cash_only',
      },
      metrics_clicks: 12,
      metrics_spend: 7,
      ad_sets: [
        adSet({
          ads: [
            ad({
              id: 'wrong-date',
              headline: 'Music Bingo 22nd May',
              primary_text: 'Walk-ins welcome for music bingo. Reserve if you want.',
              description: 'Learn more',
              cta: 'LEARN_MORE',
              metrics_clicks: 8,
              metrics_spend: 4,
            }),
          ],
        }),
      ],
    });
    const bookingSignals = buildBlendedBookingSignals([campaignRow], [{
      booking_id: 'booking-1',
      booking_type: 'event',
      event_id: 'event-1',
      event_slug: null,
      utm_campaign: null,
      utm_content: null,
      fbclid: null,
      gclid: null,
      short_code: null,
      occurred_at: syncedAt,
    }]);

    const { decisions } = evaluateCampaignOptimisation([campaignRow], { bookingSignals });
    const rewrite = decisions.find((decision) => decision.actionType === 'copy_rewrite');

    expect(rewrite).toMatchObject({
      adId: 'wrong-date',
      recommendationPayload: expect.objectContaining({
        issues: expect.arrayContaining([
          'date in ad copy does not match the imported event date',
          'CTA is not BOOK_NOW',
          'walk-ins welcome weakens the reason to reserve',
        ]),
      }),
    });
  });

  it('flags weak CTR as a booking blocker', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        metrics_impressions: 700,
        metrics_clicks: 2,
        metrics_ctr: 0.2,
      }),
    ]);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionType: 'tracking_issue',
        recommendationPayload: expect.objectContaining({ category: 'low_ctr' }),
      }),
    ]));
  });

  it('does not rewrite when there is not enough signal', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        metrics_clicks: 2,
        metrics_spend: 1,
        ad_sets: [
          adSet({
            ads: [ad({ id: 'too-early', metrics_clicks: 1, metrics_spend: 1 })],
          }),
        ],
      }),
    ]);

    expect(decisions.some((decision) => decision.actionType === 'copy_rewrite')).toBe(false);
  });

  it('treats known paid short links and expanded destinations as trackable', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        destination_url: 'https://l.the-anchor.pub/ma83ed9d',
        source_snapshot: {
          metaAdsDestinationUrl: 'https://www.the-anchor.pub/events/music-bingo-2026-05-08?utm_source=facebook',
        },
      }),
    ]);

    expect(decisions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        recommendationPayload: expect.objectContaining({ category: 'untrackable_destination' }),
      }),
    ]));
  });
});
