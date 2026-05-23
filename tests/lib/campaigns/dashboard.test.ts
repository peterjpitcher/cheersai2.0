import { describe, expect, it } from 'vitest';

import {
  buildCampaignDashboard,
  getCampaignDeliveryStatus,
} from '@/lib/campaigns/dashboard';
import type { Campaign, CampaignPerformanceMetrics } from '@/types/campaigns';

const EMPTY_PERFORMANCE: CampaignPerformanceMetrics = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  ctr: 0,
  cpc: 0,
  conversions: 0,
  costPerConversion: 0,
  conversionRate: 0,
};

function campaign(overrides: Partial<Campaign>): Campaign {
  return {
    id: overrides.id ?? 'campaign-1',
    accountId: 'account-1',
    metaCampaignId: null,
    name: overrides.name ?? 'Campaign',
    objective: 'OUTCOME_TRAFFIC',
    problemBrief: 'Brief',
    aiRationale: null,
    budgetType: 'DAILY',
    budgetAmount: 20,
    startDate: '2026-05-01',
    endDate: null,
    status: 'DRAFT',
    metaStatus: null,
    publishError: null,
    specialAdCategory: 'NONE',
    campaignKind: 'event',
    sourceType: null,
    sourceId: null,
    destinationUrl: null,
    geoRadiusMiles: 3,
    audienceMode: 'local_only',
    audienceInterestKeywords: [],
    resolvedInterests: [],
    sourceSnapshot: null,
    performance: EMPTY_PERFORMANCE,
    lastSyncedAt: new Date('2026-05-23T09:00:00Z'),
    campaignType: null,
    autoConfirm: false,
    createdAt: new Date('2026-05-01T09:00:00Z'),
    adSets: [],
    ...overrides,
  };
}

describe('campaign dashboard status alignment', () => {
  it('uses Meta status ahead of local status when Meta has synced', () => {
    const status = getCampaignDeliveryStatus({
      status: 'ACTIVE',
      metaStatus: 'PAUSED',
      endDate: null,
    });

    expect(status).toMatchObject({
      kind: 'paused',
      source: 'meta',
      label: 'Paused',
      active: false,
      finished: false,
    });
  });

  it('marks ended published campaigns as finished even if Meta still reports active', () => {
    const status = getCampaignDeliveryStatus(
      {
        status: 'ACTIVE',
        metaStatus: 'ACTIVE',
        endDate: '2026-05-22',
      },
      new Date('2026-05-23T12:00:00Z'),
    );

    expect(status).toMatchObject({
      kind: 'finished',
      source: 'schedule',
      active: false,
      finished: true,
    });
  });

  it('counts campaign health from the Meta-aligned dashboard status', () => {
    const dashboard = buildCampaignDashboard(
      [
        campaign({ id: 'meta-active', status: 'PAUSED', metaStatus: 'ACTIVE' }),
        campaign({ id: 'meta-paused', status: 'ACTIVE', metaStatus: 'PAUSED' }),
        campaign({ id: 'needs-attention', status: 'ACTIVE', metaStatus: 'WITH_ISSUES' }),
        campaign({ id: 'ended', status: 'ACTIVE', metaStatus: 'ACTIVE', endDate: '2026-05-22' }),
        campaign({ id: 'draft', status: 'DRAFT', metaStatus: null }),
      ],
      [],
      undefined,
      { now: new Date('2026-05-23T12:00:00Z') },
    );

    expect(dashboard.totals.activeCampaigns).toBe(1);
    expect(dashboard.totals.pausedCampaigns).toBe(1);
    expect(dashboard.totals.attentionCampaigns).toBe(1);
    expect(dashboard.totals.finishedCampaigns).toBe(1);
    expect(dashboard.totals.draftCampaigns).toBe(1);
  });
});
