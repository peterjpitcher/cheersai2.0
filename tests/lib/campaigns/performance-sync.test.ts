import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/meta/marketing', () => ({
  fetchMetaObjectInsights: vi.fn(),
}));

import { syncMetaCampaignPerformance } from '@/lib/campaigns/performance-sync';
import { fetchMetaObjectInsights } from '@/lib/meta/marketing';

function selectBuilder(data: unknown, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data, error })),
    single: vi.fn(async () => ({ data, error })),
  };
  return builder;
}

function updateBuilder(table: string, updates: Array<{ table: string; payload: Record<string, unknown> }>) {
  return {
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push({ table, payload });
      return { eq: vi.fn(async () => ({ error: null })) };
    }),
  };
}

describe('syncMetaCampaignPerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs campaign, ad set, and ad metrics', async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const queues: Record<string, unknown[]> = {
      meta_campaigns: [
        selectBuilder({
          id: 'campaign-1',
          account_id: 'account-1',
          meta_campaign_id: 'meta-campaign-1',
          start_date: '2026-04-01',
          end_date: '2026-04-10',
          ad_sets: [{
            id: 'adset-1',
            meta_adset_id: 'meta-adset-1',
            ads: [{ id: 'ad-1', meta_ad_id: 'meta-ad-1' }],
          }],
        }),
        updateBuilder('meta_campaigns', updates),
      ],
      meta_ad_accounts: [
        selectBuilder({
          access_token: 'token',
          token_expires_at: '2999-01-01T00:00:00.000Z',
        }),
      ],
      ad_sets: [updateBuilder('ad_sets', updates)],
      ads: [updateBuilder('ads', updates)],
    };
    const supabase = {
      from: vi.fn((table: string) => queues[table]?.shift()),
    };

    vi.mocked(fetchMetaObjectInsights)
      .mockResolvedValueOnce({ spend: 10, impressions: 1000, reach: 800, clicks: 50, ctr: 5, cpc: 0.2, status: 'ACTIVE' })
      .mockResolvedValueOnce({ spend: 6, impressions: 600, reach: 500, clicks: 30, ctr: 5, cpc: 0.2, status: 'ACTIVE' })
      .mockResolvedValueOnce({ spend: 4, impressions: 400, reach: 300, clicks: 20, ctr: 5, cpc: 0.2, status: 'ACTIVE' });

    const result = await syncMetaCampaignPerformance('campaign-1', {
      accountId: 'account-1',
      supabase: supabase as never,
    });

    expect(result).toEqual({ campaignSynced: true, adSetsSynced: 1, adsSynced: 1 });
    expect(fetchMetaObjectInsights).toHaveBeenNthCalledWith(1, 'meta-campaign-1', 'token', {
      since: '2026-04-01',
      until: '2026-04-10',
    });
    expect(fetchMetaObjectInsights).toHaveBeenNthCalledWith(2, 'meta-adset-1', 'token', {
      since: '2026-04-01',
      until: '2026-04-10',
    });
    expect(fetchMetaObjectInsights).toHaveBeenNthCalledWith(3, 'meta-ad-1', 'token', {
      since: '2026-04-01',
      until: '2026-04-10',
    });
    expect(updates.map((update) => update.table)).toEqual(['meta_campaigns', 'ad_sets', 'ads']);
    expect(updates[0].payload).toMatchObject({
      metrics_reach: 800,
      metrics_clicks: 50,
      meta_status: 'ACTIVE',
    });
  });

  it('blocks unpublished campaigns', async () => {
    const queues: Record<string, unknown[]> = {
      meta_campaigns: [
        selectBuilder({
          id: 'campaign-1',
          account_id: 'account-1',
          meta_campaign_id: null,
          start_date: '2026-04-01',
          end_date: '2026-04-10',
          ad_sets: [],
        }),
      ],
    };
    const supabase = {
      from: vi.fn((table: string) => queues[table]?.shift()),
    };

    await expect(syncMetaCampaignPerformance('campaign-1', {
      accountId: 'account-1',
      supabase: supabase as never,
    })).rejects.toThrow('Publish this campaign');
    expect(fetchMetaObjectInsights).not.toHaveBeenCalled();
  });
});
