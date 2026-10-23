import { describe, expect, it, vi, beforeEach } from 'vitest';

// Meta Ads tokens come from encrypted storage (src/lib/meta/ad-account-tokens.ts,
// tested on its own). A plain function, so vi.resetAllMocks cannot wipe it.
const DEFAULT_AD_TOKENS = { accessToken: 'token' as string | null, conversionsApiToken: null as string | null };
const adTokens = vi.hoisted(() => ({ current: null as null | { accessToken: string | null; conversionsApiToken: string | null } }));
vi.mock('@/lib/meta/ad-account-tokens', () => ({
  getMetaAdAccountTokens: async () => adTokens.current ?? DEFAULT_AD_TOKENS,
  storeMetaAdAccountToken: async () => undefined,
}));

vi.mock('@/lib/meta/marketing', () => ({
  fetchMetaObjectInsights: vi.fn(),
}));

import { statusFollowingMeta, syncMetaCampaignPerformance } from '@/lib/campaigns/performance-sync';
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

function upsertBuilder(
  table: string,
  upserts: Array<{ table: string; payload: Record<string, unknown> }>,
  error: { message: string; code?: string } | null = null,
) {
  return {
    upsert: vi.fn(async (payload: Record<string, unknown>) => {
      upserts.push({ table, payload });
      return { error };
    }),
  };
}

describe('syncMetaCampaignPerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs campaign, ad set, and ad metrics', async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
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
      // Per ad: an `ads` snapshot update, then an `ad_metrics_history` upsert.
      ads: [updateBuilder('ads', updates)],
      ad_metrics_history: [upsertBuilder('ad_metrics_history', upserts)],
    };
    const supabase = {
      from: vi.fn((table: string) => queues[table]?.shift()),
    };

    vi.mocked(fetchMetaObjectInsights)
      .mockResolvedValueOnce({ spend: 10, impressions: 1000, reach: 800, clicks: 50, reactions: 12, comments: 3, shares: 2, ctr: 5, cpc: 0.2, conversions: 2, costPerConversion: 5, conversionRate: 4, status: 'ACTIVE' })
      .mockResolvedValueOnce({ spend: 6, impressions: 600, reach: 500, clicks: 30, reactions: 7, comments: 2, shares: 1, ctr: 5, cpc: 0.2, conversions: 1, costPerConversion: 6, conversionRate: 3.33, status: 'ACTIVE' })
      .mockResolvedValueOnce({ spend: 4, impressions: 400, reach: 300, clicks: 20, reactions: 4, comments: 1, shares: 1, ctr: 5, cpc: 0.2, conversions: 1, costPerConversion: 4, conversionRate: 5, status: 'ACTIVE' });

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
      metrics_reactions: 12,
      metrics_comments: 3,
      metrics_shares: 2,
      metrics_conversions: 2,
      metrics_cost_per_conversion: 5,
      metrics_conversion_rate: 4,
      meta_status: 'ACTIVE',
    });
    expect(updates[1].payload).toMatchObject({
      metrics_reactions: 7,
      metrics_comments: 2,
      metrics_shares: 1,
    });
    expect(updates[2].payload).toMatchObject({
      metrics_reactions: 4,
      metrics_comments: 1,
      metrics_shares: 1,
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe('ad_metrics_history');
    expect(upserts[0].payload).toMatchObject({
      account_id: 'account-1',
      ad_id: 'ad-1',
      impressions: 400,
      clicks: 20,
      ctr: 5,
      spend: 4,
    });
    // frequency = impressions / reach = 400 / 300
    expect(upserts[0].payload.frequency).toBeCloseTo(400 / 300, 6);
    expect(upserts[0].payload).not.toHaveProperty('reactions');
    expect(upserts[0].payload).not.toHaveProperty('comments');
    expect(upserts[0].payload).not.toHaveProperty('shares');
    expect(typeof upserts[0].payload.captured_on).toBe('string');
    expect(upserts[0].payload.captured_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('records a null history frequency when reach is zero', async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
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
        selectBuilder({ access_token: 'token', token_expires_at: '2999-01-01T00:00:00.000Z' }),
      ],
      ad_sets: [updateBuilder('ad_sets', updates)],
      ads: [updateBuilder('ads', updates)],
      ad_metrics_history: [upsertBuilder('ad_metrics_history', upserts)],
    };
    const supabase = { from: vi.fn((table: string) => queues[table]?.shift()) };

    vi.mocked(fetchMetaObjectInsights)
      .mockResolvedValueOnce({ spend: 10, impressions: 1000, reach: 800, clicks: 50, reactions: 12, comments: 3, shares: 2, ctr: 5, cpc: 0.2, conversions: 2, costPerConversion: 5, conversionRate: 4, status: 'ACTIVE' })
      .mockResolvedValueOnce({ spend: 6, impressions: 600, reach: 500, clicks: 30, reactions: 7, comments: 2, shares: 1, ctr: 5, cpc: 0.2, conversions: 1, costPerConversion: 6, conversionRate: 3.33, status: 'ACTIVE' })
      .mockResolvedValueOnce({ spend: 0, impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, ctr: 0, cpc: 0, conversions: 0, costPerConversion: 0, conversionRate: 0, status: 'ACTIVE' });

    await syncMetaCampaignPerformance('campaign-1', { accountId: 'account-1', supabase: supabase as never });

    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload.frequency).toBeNull();
  });

  it('WF-2: keeps syncing the remaining ads when a history append fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
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
            ads: [
              { id: 'ad-1', meta_ad_id: 'meta-ad-1' },
              { id: 'ad-2', meta_ad_id: 'meta-ad-2' },
            ],
          }],
        }),
        updateBuilder('meta_campaigns', updates),
      ],
      meta_ad_accounts: [
        selectBuilder({ access_token: 'token', token_expires_at: '2999-01-01T00:00:00.000Z' }),
      ],
      ad_sets: [updateBuilder('ad_sets', updates)],
      ads: [updateBuilder('ads', updates), updateBuilder('ads', updates)],
      ad_metrics_history: [
        // First ad's history append fails (e.g. table missing or transient error)…
        upsertBuilder('ad_metrics_history', upserts, { message: 'history append boom' }),
        // …the second ad's append still runs and succeeds.
        upsertBuilder('ad_metrics_history', upserts),
      ],
    };
    const supabase = { from: vi.fn((table: string) => queues[table]?.shift()) };

    const insights = { spend: 4, impressions: 400, reach: 300, clicks: 20, reactions: 4, comments: 1, shares: 1, ctr: 5, cpc: 0.2, conversions: 1, costPerConversion: 4, conversionRate: 5, status: 'ACTIVE' };
    vi.mocked(fetchMetaObjectInsights).mockResolvedValue(insights);

    try {
      // Must not throw: the history table is advisory, the nightly sync is not.
      const result = await syncMetaCampaignPerformance('campaign-1', {
        accountId: 'account-1',
        supabase: supabase as never,
      });

      expect(result).toEqual({ campaignSynced: true, adSetsSynced: 1, adsSynced: 2 });
      // Both ads still had their snapshot metrics updated…
      expect(updates.filter((update) => update.table === 'ads')).toHaveLength(2);
      // …and both history appends were attempted (the second succeeded).
      expect(upserts).toHaveLength(2);
      // The failure is logged once, not once per ad.
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
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

/** A conditional update: records the payload and its three filters, then resolves on the third eq. */
function statusUpdateBuilder(
  calls: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  error: { message: string } | null = null,
) {
  return {
    update: vi.fn((payload: Record<string, unknown>) => {
      const filters: Array<[string, unknown]> = [];
      calls.push({ payload, filters });
      const chain = {
        eq: vi.fn((column: string, value: unknown) => {
          filters.push([column, value]);
          return filters.length === 3 ? Promise.resolve({ error }) : chain;
        }),
      };
      return chain;
    }),
  };
}

describe('a campaign paused or switched back on in Ads Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const insights = (status: string) => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, ctr: 0, cpc: 0, conversions: 0, costPerConversion: 0, conversionRate: 0, status });

  function setUp(appStatus: string, metaStatus: string, statusError: { message: string } | null = null) {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const statusCalls: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
    const queues: Record<string, unknown[]> = {
      meta_campaigns: [
        selectBuilder({
          id: 'campaign-1',
          account_id: 'account-1',
          meta_campaign_id: 'meta-campaign-1',
          status: appStatus,
          start_date: '2026-09-11',
          end_date: '2026-10-16',
          ad_sets: [],
        }),
        updateBuilder('meta_campaigns', updates),
        statusUpdateBuilder(statusCalls, statusError),
      ],
      meta_ad_accounts: [selectBuilder({ token_expires_at: '2999-01-01T00:00:00.000Z' })],
    };
    const supabase = { from: vi.fn((table: string) => queues[table]?.shift()) };
    vi.mocked(fetchMetaObjectInsights).mockResolvedValueOnce(insights(metaStatus));
    const sync = () => syncMetaCampaignPerformance('campaign-1', { accountId: 'account-1', supabase: supabase as never });
    return { updates, statusCalls, supabase, sync };
  }

  it('shows a campaign paused in Ads Manager as paused, scoped to the brand and only if the app has not changed it meanwhile', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { updates, statusCalls, sync } = setUp('ACTIVE', 'PAUSED');
      await sync();

      expect(updates[0].payload).toMatchObject({ meta_status: 'PAUSED' });
      expect(statusCalls).toEqual([{ payload: { status: 'PAUSED' }, filters: [['id', 'campaign-1'], ['account_id', 'account-1'], ['status', 'ACTIVE']] }]);
      expect(info).toHaveBeenCalledWith('[performance-sync] campaign status now follows Meta', { campaignId: 'campaign-1', from: 'ACTIVE', to: 'PAUSED' });
    } finally {
      info.mockRestore();
    }
  });

  it('shows a campaign switched back on in Ads Manager as active', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { statusCalls, sync } = setUp('PAUSED', 'ACTIVE');
      await sync();

      expect(statusCalls).toEqual([{ payload: { status: 'ACTIVE' }, filters: [['id', 'campaign-1'], ['account_id', 'account-1'], ['status', 'PAUSED']] }]);
    } finally {
      info.mockRestore();
    }
  });

  it.each([
    ['ACTIVE', 'ACTIVE'],
    ['PAUSED', 'PAUSED'],
    ['ACTIVE', 'ARCHIVED'],
    ['ACTIVE', 'DELETED'],
    ['ACTIVE', 'UNKNOWN'],
  ])('leaves an app status of %s alone when Meta reports %s', async (appStatus, metaStatus) => {
    const { updates, statusCalls, supabase, sync } = setUp(appStatus, metaStatus);
    await sync();

    expect(updates[0].payload).toMatchObject({ meta_status: metaStatus });
    expect(statusCalls).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(3);
  });

  it('fails the sync when the followed status cannot be stored', async () => {
    const { sync } = setUp('ACTIVE', 'PAUSED', { message: 'update refused' });
    await expect(sync()).rejects.toThrow('update refused');
  });
});

describe('statusFollowingMeta', () => {
  it('follows only a move between ACTIVE and PAUSED, whatever the case Meta uses', () => {
    expect(statusFollowingMeta('ACTIVE', 'PAUSED')).toBe('PAUSED');
    expect(statusFollowingMeta('ACTIVE', ' paused ')).toBe('PAUSED');
    expect(statusFollowingMeta('PAUSED', 'ACTIVE')).toBe('ACTIVE');
    expect(statusFollowingMeta('ACTIVE', 'ACTIVE')).toBeNull();
    expect(statusFollowingMeta('DRAFT', 'PAUSED')).toBeNull();
    expect(statusFollowingMeta('ARCHIVED', 'ACTIVE')).toBeNull();
    expect(statusFollowingMeta('PAUSED', 'ARCHIVED')).toBeNull();
    expect(statusFollowingMeta(null, 'PAUSED')).toBeNull();
    expect(statusFollowingMeta(undefined, 'PAUSED')).toBeNull();
    expect(statusFollowingMeta('ACTIVE', null)).toBeNull();
  });
});
