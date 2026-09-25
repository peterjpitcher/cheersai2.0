import { describe, expect, it, vi } from 'vitest';

// Meta Ads tokens come from encrypted storage (src/lib/meta/ad-account-tokens.ts,
// tested on its own). A plain function, so vi.resetAllMocks cannot wipe it.
const DEFAULT_AD_TOKENS = { accessToken: 'token' as string | null, conversionsApiToken: 'capi-token' as string | null };
const adTokens = vi.hoisted(() => ({ current: null as null | { accessToken: string | null; conversionsApiToken: string | null } }));
vi.mock('@/lib/meta/ad-account-tokens', () => ({
  getMetaAdAccountTokens: async () => adTokens.current ?? DEFAULT_AD_TOKENS,
  storeMetaAdAccountToken: async () => undefined,
}));

import {
  buildBlendedBookingSignals,
  evaluateAdSetOptimisation,
  evaluateCampaignOptimisation,
  runMetaCampaignOptimisation,
  type BookingConversionEventForOptimisation,
  type OptimisationAdRow,
  type OptimisationAdSetRow,
  type OptimisationCampaignRow,
} from '@/lib/campaigns/optimisation';
import type { AdMetricsHistoryRow } from '@/lib/campaigns/creative-fatigue';

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
        ad({ id: 'loser', meta_ad_id: 'meta-loser', metrics_conversions: 0, metrics_spend: 12 }),
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
        ad({ id: 'strong', meta_ad_id: 'meta-strong', metrics_impressions: 1200, metrics_clicks: 24, metrics_ctr: 2, metrics_spend: 18 }),
        ad({ id: 'weak', meta_ad_id: 'meta-weak', metrics_impressions: 1400, metrics_clicks: 3, metrics_ctr: 0.21, metrics_spend: 12 }),
        ad({ id: 'also-weak', meta_ad_id: 'meta-also-weak', metrics_impressions: 1300, metrics_clicks: 5, metrics_ctr: 0.38, metrics_spend: 11 }),
      ],
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.adId).toBe('weak');
  });

  it('uses first-party ad-level bookings as conversion evidence', () => {
    const decisions = evaluateAdSetOptimisation(
      campaign({}),
      adSet({}),
      [
        ad({ id: 'winner', meta_ad_id: 'meta-winner', metrics_conversions: 0, metrics_spend: 3 }),
        ad({ id: 'loser', meta_ad_id: 'meta-loser', metrics_conversions: 0, metrics_spend: 12 }),
      ],
      {
        campaignId: 'campaign-1',
        metaBookings: 0,
        firstPartyBookings: 1,
        firstPartyBookingValue: 24,
        blendedBookings: 1,
        blendedBookingValue: 24,
        adBookings: { winner: 1 },
        adBookingValue: { winner: 24 },
        adSetBookings: { 'adset-1': 1 },
        adSetBookingValue: { 'adset-1': 24 },
        trackingMismatch: true,
      },
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.adId).toBe('loser');
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

describe('creative fatigue', () => {
  /** 15 CUMULATIVE daily snapshots (lifetime totals, as performance-sync stores them). */
  function fatigueRows(adId: string, latestFrequency: number): AdMetricsHistoryRow[] {
    const rows: AdMetricsHistoryRow[] = [];
    const end = new Date('2026-06-08T00:00:00.000Z');
    let impressions = 0;
    let clicks = 0;
    for (let i = 14; i >= 0; i--) {
      const day = new Date(end);
      day.setUTCDate(end.getUTCDate() - i);
      impressions += 1500;
      clicks += 30;
      rows.push({
        adId,
        capturedOn: day.toISOString().slice(0, 10),
        impressions,
        clicks,
        ctr: (clicks / impressions) * 100,
        // Lifetime frequency drifts up to the latest reported value.
        frequency: i === 0 ? latestFrequency : 1.2,
        spend: 5,
      });
    }
    return rows;
  }

  it('records a creative_fatigue warning and never a pause for an over-served ad', () => {
    const { decisions } = evaluateCampaignOptimisation(
      [
        campaign({
          ad_sets: [
            adSet({
              ads: [
                ad({ id: 'tired', meta_ad_id: 'meta-tired' }),
                ad({ id: 'fresh', meta_ad_id: 'meta-fresh' }),
              ],
            }),
          ],
        }),
      ],
      { fatigueHistory: new Map([['tired', fatigueRows('tired', 3.5)]]) },
    );

    const fatigue = decisions.filter((decision) => decision.actionType === 'creative_fatigue');
    expect(fatigue).toHaveLength(1);
    expect(fatigue[0]).toMatchObject({
      adId: 'tired',
      metaObjectId: 'meta-tired',
      severity: 'warning',
    });
    expect(fatigue[0]?.reason).toMatch(/frequency/i);
    expect(decisions.some((decision) => decision.actionType === 'pause_ad' && decision.adId === 'tired')).toBe(false);
  });

  it('does not record fatigue for a healthy ad', () => {
    const { decisions } = evaluateCampaignOptimisation(
      [
        campaign({
          ad_sets: [adSet({ ads: [ad({ id: 'healthy', meta_ad_id: 'meta-healthy' })] })],
        }),
      ],
      { fatigueHistory: new Map([['healthy', fatigueRows('healthy', 1.3)]]) },
    );

    expect(decisions.some((decision) => decision.actionType === 'creative_fatigue')).toBe(false);
  });

  it('abstains when there is no history for the ad', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        ad_sets: [adSet({ ads: [ad({ id: 'unknown', meta_ad_id: 'meta-unknown' })] })],
      }),
    ]);

    expect(decisions.some((decision) => decision.actionType === 'creative_fatigue')).toBe(false);
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
      // Matched to the campaign, but this booking has no ad attribution or consent,
      // so it cannot appear in Meta and must not raise a tracking-mismatch alert.
      trackingMismatch: false,
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
      // Short-code match only — no ad attribution or consent, so not a mismatch.
      trackingMismatch: false,
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

  it('attributes first-party bookings and value to ads by utm_content', () => {
    const campaignRow = campaign({
      source_id: 'event-1',
      ad_sets: [
        adSet({
          id: 'adset-1',
          ads: [
            ad({ id: 'ad-1', utm_content_key: 'ad__quiz__run_up__venue_photo' }),
            ad({ id: 'ad-2', utm_content_key: 'ad__quiz__run_up__people_social' }),
          ],
        }),
      ],
    });
    const signals = buildBlendedBookingSignals([campaignRow], [{
      ...bookingEvent,
      utm_content: 'ad__quiz__run_up__people_social',
      value: 18,
    }]);

    expect(signals.get('campaign-1')).toMatchObject({
      firstPartyBookings: 1,
      firstPartyBookingValue: 18,
      adBookings: { 'ad-2': 1 },
      adBookingValue: { 'ad-2': 18 },
      adSetBookings: { 'adset-1': 1 },
    });
  });

  // A booking we can tie to one of the campaign's own ads (utm_content → utm_content_key)
  // AND that carried marketing consent — the only kind Meta genuinely should have counted.
  const attributedConsentedEvent: BookingConversionEventForOptimisation = {
    ...bookingEvent,
    utm_content: 'ad__quiz__run_up__people_social',
    meta_consent_granted: true,
  };

  function campaignWithAttributableAd(overrides: Partial<OptimisationCampaignRow> = {}) {
    return campaign({
      source_id: 'event-1',
      metrics_conversions: 0,
      ad_sets: [
        adSet({ ads: [ad({ id: 'ad-2', utm_content_key: 'ad__quiz__run_up__people_social' })] }),
      ],
      ...overrides,
    });
  }

  it('classifies Meta zero with a consented, ad-attributed booking as a tracking mismatch', () => {
    const campaignRow = campaignWithAttributableAd();
    const bookingSignals = buildBlendedBookingSignals([campaignRow], [attributedConsentedEvent]);

    expect(bookingSignals.get('campaign-1')?.trackingMismatch).toBe(true);

    const { decisions } = evaluateCampaignOptimisation([campaignRow], { bookingSignals });
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionType: 'tracking_issue',
        recommendationPayload: expect.objectContaining({ category: 'meta_first_party_mismatch' }),
      }),
    ]));
  });

  it('does not raise a mismatch when the ad-attributed booking was not consented', () => {
    const campaignRow = campaignWithAttributableAd();
    const signals = buildBlendedBookingSignals(
      [campaignRow],
      [{ ...attributedConsentedEvent, meta_consent_granted: false }],
    );

    expect(signals.get('campaign-1')?.trackingMismatch).toBe(false);
  });

  it('does not raise a mismatch when a consented booking is not attributed to any ad', () => {
    const campaignRow = campaignWithAttributableAd();
    const signals = buildBlendedBookingSignals(
      [campaignRow],
      [{ ...attributedConsentedEvent, utm_content: 'facebook_main' }],
    );

    expect(signals.get('campaign-1')).toMatchObject({
      firstPartyBookings: 1,
      trackingMismatch: false,
    });
  });
});

describe('copy recommendations', () => {
  it('creates copy rewrite recommendations for clicks with no blended bookings', () => {
    const { decisions } = evaluateCampaignOptimisation([
      campaign({
        name: 'Evergreen quiz push B',
        campaign_kind: 'evergreen',
        metrics_clicks: 12,
        metrics_spend: 7,
        metrics_conversions: 0,
        ad_sets: [
          adSet({
            ads: [
              ad({
                id: 'weak-copy',
                meta_ad_id: 'meta-weak-copy',
                headline: 'Quiz night, Wednesdays at 8pm',
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

  describe('public copy never uses internal text', () => {
    // Mirrors the four live "Weekday ..." custom promotions on 22 September 2026.
    const weekdayLunchBrief =
      'Weekday lunch at The Anchor, Stanwell Moor: lunch is served Tuesday to Friday, 12pm to 3pm (new since 1 September 2026). '
      + 'This is a message test with three ads: 1) news, we now do lunch; 2) value, lunch from £9.';

    function weekdayLunchCampaign(ads: OptimisationAdRow[]) {
      return campaign({
        name: 'Weekday Lunch A (cod and chips)',
        campaign_kind: 'evergreen',
        source_type: 'custom_promotion',
        problem_brief: weekdayLunchBrief,
        source_snapshot: { bookingConversionOptimised: true, shortCode: 'weekday-lunch' },
        metrics_clicks: 40,
        metrics_spend: 18,
        metrics_conversions: 0,
        ad_sets: [adSet({ ads })],
      });
    }

    function proposedCopy(decisions: ReturnType<typeof evaluateCampaignOptimisation>['decisions']) {
      return decisions
        .filter((decision) => decision.actionType === 'copy_rewrite')
        .map((decision) => decision.recommendationPayload.proposed as { headline: string; primaryText: string; description: string });
    }

    function expectNoCampaignName(copy: { headline: string; primaryText: string }, campaignName: string) {
      expect(copy.headline.toLowerCase()).not.toContain(campaignName.toLowerCase());
      expect(copy.primaryText.toLowerCase()).not.toContain(campaignName.toLowerCase());
    }

    it('builds an evergreen rewrite from the ad’s own copy, never the campaign name or brief', () => {
      const valueAd = ad({
        id: 'value-ad',
        name: 'Evergreen Test | Value for money | Var 2',
        headline: 'Lunch from £9, Tuesday to Friday',
        primary_text:
          'Lunch break sorted. Snack pots are £9, a wrap with chips is £10 and burgers start at £11, served Tuesday to Friday from 12pm to 3pm. '
          + 'Free on-site parking makes it easy to pop over. Your local in Stanwell Moor.',
        description: 'Snack pots £9, wraps £10',
        cta: 'BOOK_NOW',
        metrics_clicks: 14,
        metrics_spend: 6,
        metrics_impressions: 2400,
      });

      const { decisions } = evaluateCampaignOptimisation([weekdayLunchCampaign([valueAd])]);
      const [copy] = proposedCopy(decisions);

      expect(copy).toBeDefined();
      expectNoCampaignName(copy, 'Weekday Lunch A (cod and chips)');
      expect(copy.headline).toBe('Lunch from £9, Tuesday to Friday');
      expect(copy.primaryText).toContain('Snack pots are £9');
      expect(copy.primaryText).toContain("Book your table online and we'll have it ready for you.");
      expect(copy.primaryText).not.toMatch(/new since|message test|make the plan easy/i);
    });

    it('does not rewrite an evergreen ad that already asks for a booking and breaks no rule', () => {
      const bookingAd = ad({
        id: 'booking-ad',
        headline: 'Now serving lunch, Tue to Fri, 12 to 3',
        primary_text: "We're now open for lunch Tuesday to Friday, 12pm to 3pm. Book a table or come as you are.",
        description: 'Lunch served 12pm to 3pm',
        metrics_clicks: 20,
        metrics_spend: 8,
      });

      const { decisions } = evaluateCampaignOptimisation([weekdayLunchCampaign([bookingAd])]);

      expect(proposedCopy(decisions)).toEqual([]);
    });

    it('does not rewrite an evergreen ad whose headline states no concrete fact', () => {
      const moodAd = ad({
        id: 'mood-ad',
        headline: 'Proper pub lunch',
        primary_text: 'Proper pub food in Stanwell Moor.',
        description: 'Proper pub food',
        metrics_clicks: 20,
        metrics_spend: 8,
      });

      const { decisions } = evaluateCampaignOptimisation([weekdayLunchCampaign([moodAd])]);

      expect(proposedCopy(decisions)).toEqual([]);
    });

    it('drops a walk-ins sentence from an evergreen ad instead of inventing new copy', () => {
      const walkInAd = ad({
        id: 'walk-in-ad',
        headline: 'Lunch from £9, Tuesday to Friday',
        primary_text: 'Snack pots are £9 and wraps are £10. Walk-ins welcome at lunch. Book a table for your lunch break.',
        metrics_clicks: 20,
        metrics_spend: 8,
      });

      const { decisions } = evaluateCampaignOptimisation([weekdayLunchCampaign([walkInAd])]);
      const [copy] = proposedCopy(decisions);

      expect(copy.primaryText).toBe('Snack pots are £9 and wraps are £10. Book a table for your lunch break.');
      expectNoCampaignName(copy, 'Weekday Lunch A (cod and chips)');
    });

    it('does not rewrite an evergreen ad whose own copy already carries the campaign name', () => {
      const leakedAd = ad({
        id: 'leaked-ad',
        headline: 'Lunch from £9, Tuesday to Friday',
        primary_text: 'Reserve a table for Weekday Lunch A (cod and chips). Walk-ins welcome.',
        metrics_clicks: 20,
        metrics_spend: 8,
      });

      const { decisions } = evaluateCampaignOptimisation([weekdayLunchCampaign([leakedAd])]);

      expect(proposedCopy(decisions)).toEqual([]);
    });

    it('uses the imported event name and facts for event rewrites, never the campaign name or brief', () => {
      const campaignName = 'Cowboys & Queens Country Music Bingo 2026 (Traffic)';
      const { decisions } = evaluateCampaignOptimisation([
        campaign({
          name: campaignName,
          campaign_kind: 'event',
          problem_brief: 'Cowboys & Queens Country Music Bingo on 2026-08-14. Here’s the updated brief: The Ultimate Country Party.',
          source_snapshot: {
            bookingConversionOptimised: true,
            eventName: 'Cowboys & Queens Country Music Bingo',
            eventDate: '2026-08-14',
            eventTime: '19:00',
            pricePerSeat: 5,
          },
          metrics_clicks: 30,
          metrics_spend: 12,
          ad_sets: [
            adSet({
              ads: [
                ad({
                  id: 'event-ad',
                  headline: 'Country music bingo',
                  primary_text: 'A brilliant evening is coming.',
                  description: 'Learn more',
                  cta: 'LEARN_MORE',
                  metrics_clicks: 12,
                  metrics_spend: 6,
                }),
              ],
            }),
          ],
        }),
      ]);
      const [copy] = proposedCopy(decisions);

      expect(copy).toBeDefined();
      expectNoCampaignName(copy, campaignName);
      expect(copy.headline).toContain('Cowboys & Queens');
      expect(copy.primaryText).toContain('Friday 14 August');
      expect(copy.primaryText).toContain('£5 per person, starts at 7pm.');
      expect(copy.primaryText).not.toMatch(/updated brief|ultimate|2026-08-14/i);
    });

    it('records no rewrites for a campaign marked as a controlled test', () => {
      const walkInAd = ad({
        id: 'walk-in-ad',
        headline: 'Lunch from £9, Tuesday to Friday',
        primary_text: 'Snack pots are £9 and wraps are £10. Walk-ins welcome at lunch.',
        metrics_clicks: 20,
        metrics_spend: 8,
      });

      const unflagged = evaluateCampaignOptimisation([weekdayLunchCampaign([walkInAd])]);
      const flagged = evaluateCampaignOptimisation([{ ...weekdayLunchCampaign([walkInAd]), controlled_test: true }]);

      expect(proposedCopy(unflagged.decisions)).toHaveLength(1);
      expect(proposedCopy(flagged.decisions)).toEqual([]);
    });

    it('does not rewrite an event campaign that has no imported event name', () => {
      const { decisions } = evaluateCampaignOptimisation([
        campaign({
          name: 'Music Bingo | Warm push',
          campaign_kind: 'event',
          source_snapshot: { bookingConversionOptimised: true, eventDate: '2026-05-08T20:00:00+01:00' },
          metrics_clicks: 12,
          metrics_spend: 7,
          ad_sets: [
            adSet({
              ads: [
                ad({
                  id: 'wrong-date',
                  headline: 'Music Bingo 22nd May',
                  primary_text: 'Walk-ins welcome for music bingo.',
                  cta: 'LEARN_MORE',
                  metrics_clicks: 8,
                  metrics_spend: 4,
                }),
              ],
            }),
          ],
        }),
      ]);

      expect(proposedCopy(decisions)).toEqual([]);
    });
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

describe('runMetaCampaignOptimisation action recording', () => {
  interface MockResult {
    data: unknown;
    error: { message: string } | null;
  }

  /** Chainable, awaitable Supabase query stub: filters return the chain, awaiting resolves `result`. */
  function thenableChain(result: MockResult) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'in', 'not', 'order']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.single = vi.fn(async () => result);
    chain.maybeSingle = vi.fn(async () => result);
    chain.then = (
      resolve: (value: MockResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return chain;
  }

  function optimisationRunHarness(args: {
    campaigns: OptimisationCampaignRow[];
    historyRows?: Array<Record<string, unknown>>;
    recentActionRows?: Array<Record<string, unknown>>;
    actionInsertError?: { message: string } | null;
    bookingError?: { message: string };
    managementConnection?: { base_url: string; api_key: string; enabled: boolean };
  }) {
    const actionInserts: Array<Record<string, unknown>> = [];
    const runUpdates: Array<Record<string, unknown>> = [];

    const from = vi.fn((table: string) => {
      switch (table) {
        case 'meta_optimisation_runs':
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { id: 'run-1' }, error: null })),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              runUpdates.push(payload);
              return { eq: vi.fn(async () => ({ error: null })) };
            }),
          };
        case 'meta_ad_accounts':
          return thenableChain({
            data: {
              access_token: 'token',
              token_expires_at: '2999-01-01T00:00:00.000Z',
              meta_pixel_id: '123456789012345',
              conversion_event_name: 'Purchase',
              conversion_optimisation_enabled: true,
              conversions_api_access_token: 'capi-token',
            },
            error: null,
          });
        case 'meta_campaigns':
          return thenableChain({ data: args.campaigns, error: null });
        case 'booking_conversion_events':
          return thenableChain({ data: [], error: args.bookingError ?? null });
        case 'management_app_connections':
          return thenableChain({ data: args.managementConnection ?? null, error: null });
        case 'ad_metrics_history':
          return thenableChain({ data: args.historyRows ?? [], error: null });
        case 'meta_optimisation_actions':
          return {
            select: vi.fn(() => thenableChain({ data: args.recentActionRows ?? [], error: null })),
            insert: vi.fn((payload: Record<string, unknown>) => {
              actionInserts.push(payload);
              return Promise.resolve({ error: args.actionInsertError ?? null });
            }),
          };
        default:
          throw new Error(`Unexpected table in optimisation run test: ${table}`);
      }
    });

    return { supabase: { from } as never, actionInserts, runUpdates };
  }

  /** CUMULATIVE snapshots whose latest lifetime frequency trips the fatigue threshold. */
  function fatiguedHistoryDbRows(adId: string): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    const end = new Date('2026-06-08T00:00:00.000Z');
    let impressions = 0;
    let clicks = 0;
    for (let i = 14; i >= 0; i--) {
      const day = new Date(end);
      day.setUTCDate(end.getUTCDate() - i);
      impressions += 1500;
      clicks += 30;
      rows.push({
        ad_id: adId,
        captured_on: day.toISOString().slice(0, 10),
        impressions,
        clicks,
        ctr: (clicks / impressions) * 100,
        frequency: i === 0 ? 3.5 : 1.2,
        spend: 5,
      });
    }
    return rows;
  }

  function fatiguedCampaignFixture(): OptimisationCampaignRow[] {
    return [
      campaign({
        ad_sets: [adSet({ ads: [ad({ id: 'ad-1', meta_ad_id: 'meta-ad-1' })] })],
      }),
    ];
  }

  it('records a failed run without recommendations when first-party bookings cannot be loaded', async () => {
    const harness = optimisationRunHarness({ campaigns: fatiguedCampaignFixture(), bookingError: { message: 'database unavailable' } });
    await expect(runMetaCampaignOptimisation({ accountId: 'account-1', supabase: harness.supabase })).rejects.toThrow('Booking conversion data could not be loaded');
    expect(harness.actionInserts).toHaveLength(0);
    expect(harness.runUpdates).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it.each([500, 200])('records a failed run for unavailable or malformed management bookings (HTTP %s)', async (status) => {
    const harness = optimisationRunHarness({
      campaigns: [campaign({ source_id: 'event-1', source_type: 'event' })],
      managementConnection: { base_url: 'https://management.example.com', api_key: 'private-key', enabled: true },
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'upstream-sensitive-body' }, { status })));
    try {
      await expect(runMetaCampaignOptimisation({ accountId: 'account-1', supabase: harness.supabase })).rejects.toThrow('Management booking conversions are unavailable');
      expect(harness.actionInserts).toHaveLength(0);
      expect(harness.runUpdates).toEqual([expect.objectContaining({ status: 'failed' })]);
      expect(JSON.stringify(harness.runUpdates)).not.toContain('private-key');
      expect(JSON.stringify(harness.runUpdates)).not.toContain('upstream-sensitive-body');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  const validManagementConversion = {
    booking_id: '4b73c99c-15be-45c4-951a-6a3f63cb25ab',
    event_id: 'd6253069-4228-4026-8ba0-9e4e8a9a50fb',
    occurred_at: '2026-09-05T10:00:00+00:00',
    booking_type: 'event',
    tickets: 2,
  };

  it.each([
    { success: false, data: { conversions: [validManagementConversion] } },
    { success: true, data: { conversions: [{}] } },
    { success: true, data: { conversions: [{ ...validManagementConversion, booking_id: 'invalid-id' }] } },
    { success: true, data: { conversions: [{ ...validManagementConversion, occurred_at: 'not-a-date' }] } },
    { success: true, data: { conversions: [{ ...validManagementConversion, tickets: 0 }] } },
  ])('rejects invalid conversion rows and unsuccessful envelopes before recommendations', async (payload) => {
    const harness = optimisationRunHarness({
      campaigns: [campaign({ source_id: validManagementConversion.event_id, source_type: 'event' })],
      managementConnection: { base_url: 'https://management.example.com', api_key: 'test-only', enabled: true },
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));
    try {
      await expect(runMetaCampaignOptimisation({ accountId: 'account-1', supabase: harness.supabase })).rejects.toThrow('Management booking conversions are unavailable');
      expect(harness.actionInserts).toHaveLength(0);
      expect(harness.runUpdates).toEqual([expect.objectContaining({ status: 'failed' })]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('accepts valid conversion rows from the management contract', async () => {
    const harness = optimisationRunHarness({
      campaigns: [campaign({ source_id: validManagementConversion.event_id, source_type: 'event' })],
      managementConnection: { base_url: 'https://management.example.com', api_key: 'test-only', enabled: true },
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { conversions: [validManagementConversion] } })));
    try {
      await runMetaCampaignOptimisation({ accountId: 'account-1', supabase: harness.supabase });
      expect(harness.runUpdates).toEqual([expect.objectContaining({ status: 'completed' })]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not query management bookings for a custom promotion source ID', async () => {
    const harness = optimisationRunHarness({
      campaigns: [campaign({ source_type: 'custom_promotion', campaign_kind: 'evergreen', source_id: 'promotion-1' })],
      managementConnection: { base_url: 'https://management.example.com', api_key: 'test-only', enabled: true },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await runMetaCampaignOptimisation({ accountId: 'account-1', supabase: harness.supabase });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.runUpdates).toEqual([expect.objectContaining({ status: 'completed' })]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('splits 101 distinct management events into GET batches of at most 100', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const harness = optimisationRunHarness({
      campaigns: ids.map((id) => campaign({ id, source_type: 'management_event', source_id: id })),
      managementConnection: { base_url: 'https://management.example.com', api_key: 'test-only', enabled: true },
    });
    const requestedIds: string[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const batch = new URL(url).searchParams.get('event_ids')!.split(',');
      requestedIds.push(batch);
      return Response.json({ success: true, data: { conversions: [] } });
    }));
    try {
      await runMetaCampaignOptimisation({ accountId: 'account-1', supabase: harness.supabase });
      expect(requestedIds.map((batch) => batch.length)).toEqual([100, 1]);
      expect(requestedIds.flat()).toEqual(ids);
      expect(harness.runUpdates).toEqual([expect.objectContaining({ status: 'completed' })]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('records a planned creative_fatigue action on the first run', async () => {
    const harness = optimisationRunHarness({
      campaigns: fatiguedCampaignFixture(),
      historyRows: fatiguedHistoryDbRows('ad-1'),
    });

    const result = await runMetaCampaignOptimisation({
      accountId: 'account-1',
      supabase: harness.supabase,
    });

    expect(result.plannedActions).toBe(1);
    expect(result.failedActionInserts).toBe(0);
    expect(harness.actionInserts).toHaveLength(1);
    expect(harness.actionInserts[0]).toMatchObject({
      action_type: 'creative_fatigue',
      ad_id: 'ad-1',
      status: 'planned',
    });
  });

  it('WF-3: does not re-record a creative_fatigue action when the reason text has drifted', async () => {
    const harness = optimisationRunHarness({
      campaigns: fatiguedCampaignFixture(),
      historyRows: fatiguedHistoryDbRows('ad-1'),
      // Same ad + action type recorded within the 7-day lookback, but the metrics in the
      // reason have drifted since (3.2 then vs 3.5 now). Identity must dedupe regardless.
      recentActionRows: [{
        campaign_id: 'campaign-1',
        ad_id: 'ad-1',
        action_type: 'creative_fatigue',
        reason: 'Creative fatigue: lifetime frequency reached 3.2 (threshold 3), so the same people are seeing this ad repeatedly.',
      }],
    });

    const result = await runMetaCampaignOptimisation({
      accountId: 'account-1',
      supabase: harness.supabase,
    });

    expect(result.plannedActions).toBe(0);
    expect(harness.actionInserts).toHaveLength(0);
  });

  it('WF-4: counts failed action inserts in the run summary instead of silently succeeding', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = optimisationRunHarness({
      campaigns: fatiguedCampaignFixture(),
      historyRows: fatiguedHistoryDbRows('ad-1'),
      actionInsertError: { message: 'violates check constraint "meta_optimisation_actions_action_type_check"' },
    });

    try {
      const result = await runMetaCampaignOptimisation({
        accountId: 'account-1',
        supabase: harness.supabase,
      });

      expect(result.plannedActions).toBe(1);
      expect(result.failedActionInserts).toBe(1);
      expect(consoleError).toHaveBeenCalledTimes(1);

      // The failure count is persisted in the completed run's summary.
      const completion = harness.runUpdates.find((update) => update.status === 'completed');
      expect(completion).toBeDefined();
      expect(completion?.summary).toMatchObject({ failedActionInserts: 1 });
    } finally {
      consoleError.mockRestore();
    }
  });
});
