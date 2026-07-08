import { describe, expect, it } from 'vitest';

import {
  buildBlendedBookingSignals,
  evaluateAdSetOptimisation,
  type BlendedBookingSignal,
  type BookingConversionEventForOptimisation,
  type OptimisationAdRow,
  type OptimisationCampaignRow,
} from '@/lib/campaigns/optimisation';

function campaignRow(overrides: Partial<OptimisationCampaignRow>): OptimisationCampaignRow {
  return {
    id: 'campaign',
    account_id: 'account',
    meta_campaign_id: 'meta',
    name: 'Campaign',
    status: 'ACTIVE',
    meta_status: 'ACTIVE',
    last_synced_at: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

function bookingEvent(overrides: Partial<BookingConversionEventForOptimisation>): BookingConversionEventForOptimisation {
  return {
    booking_id: 'b1',
    booking_type: 'event',
    event_id: null,
    event_slug: null,
    utm_campaign: null,
    utm_content: null,
    fbclid: null,
    gclid: null,
    short_code: null,
    occurred_at: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

function adRow(overrides: Partial<OptimisationAdRow>): OptimisationAdRow {
  return {
    id: 'ad',
    meta_ad_id: 'meta-ad',
    name: 'Ad',
    headline: 'Headline',
    primary_text: 'Body',
    description: 'Desc',
    cta: 'BOOK_NOW',
    angle: null,
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
    last_synced_at: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

function signal(overrides: Partial<BlendedBookingSignal>): BlendedBookingSignal {
  return {
    campaignId: 'campaign',
    metaBookings: 0,
    firstPartyBookings: 0,
    firstPartyBookingValue: 0,
    blendedBookings: 0,
    blendedBookingValue: 0,
    adBookings: {},
    adBookingValue: {},
    adSetBookings: {},
    adSetBookingValue: {},
    trackingMismatch: false,
    ...overrides,
  };
}

describe('buildBlendedBookingSignals — single-owner attribution (R9)', () => {
  it('credits a shared event to exactly one campaign, not both', () => {
    const c1 = campaignRow({ id: 'aaa', source_id: 'E' });
    const c2 = campaignRow({ id: 'bbb', source_id: 'E' });
    const signals = buildBlendedBookingSignals([c1, c2], [bookingEvent({ event_id: 'E' })]);

    const total = (signals.get('aaa')?.firstPartyBookings ?? 0) + (signals.get('bbb')?.firstPartyBookings ?? 0);
    expect(total).toBe(1);
    // Deterministic owner: the lowest id wins an equally-specific (event_id-level) tie.
    expect(signals.get('aaa')?.firstPartyBookings).toBe(1);
    expect(signals.get('bbb')?.firstPartyBookings).toBe(0);
  });

  it('prefers the more specific match (utm_campaign) over an event_id-only match', () => {
    const byEventId = campaignRow({ id: 'aaa', source_id: 'E', name: 'Cold Push' });
    const byName = campaignRow({ id: 'bbb', name: 'Summer Push' });
    const event = bookingEvent({ event_id: 'E', utm_campaign: 'Summer Push' });

    const signals = buildBlendedBookingSignals([byEventId, byName], [event]);
    expect(signals.get('bbb')?.firstPartyBookings).toBe(1);
    expect(signals.get('aaa')?.firstPartyBookings).toBe(0);
  });
});

describe('evaluateAdSetOptimisation — pause suppression (R5/R8)', () => {
  const campaign = { id: 'campaign', name: 'Campaign' };
  const adSet = { id: 'adset', name: 'Ad set' };
  const winner = adRow({ id: 'winner', metrics_conversions: 1 });
  const spender = adRow({ id: 'spender', metrics_spend: 20 }); // no booking, over the pause threshold

  it('does NOT pause an ad when the campaign has unattributed first-party bookings', () => {
    const decisions = evaluateAdSetOptimisation(campaign, adSet, [winner, spender], signal({ firstPartyBookings: 1 }));
    expect(decisions).toEqual([]);
  });

  it('DOES pause the sibling when every first-party booking is attributed to a specific ad', () => {
    const decisions = evaluateAdSetOptimisation(
      campaign,
      adSet,
      [winner, spender],
      signal({ firstPartyBookings: 1, adBookings: { winner: 1 } }),
    );
    expect(decisions.some((decision) => decision.adId === 'spender')).toBe(true);
    expect(decisions.some((decision) => decision.adId === 'winner')).toBe(false);
  });
});
