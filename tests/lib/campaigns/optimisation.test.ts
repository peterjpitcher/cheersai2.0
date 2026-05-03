import { describe, expect, it } from 'vitest';

import {
  evaluateAdSetOptimisation,
  evaluateCampaignOptimisation,
  type OptimisationAdRow,
  type OptimisationAdSetRow,
  type OptimisationCampaignRow,
} from '@/lib/campaigns/optimisation';

const syncedAt = '2026-05-03T06:00:00.000Z';

function ad(overrides: Partial<OptimisationAdRow>): OptimisationAdRow {
  return {
    id: 'ad-1',
    meta_ad_id: 'meta-ad-1',
    name: 'Ad 1',
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
      metaAdId: 'meta-loser',
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
