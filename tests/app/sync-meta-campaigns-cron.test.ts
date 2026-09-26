import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncMetaCampaignPerformance: vi.fn(),
  accountsResult: { data: [] as Array<{ id: string }> | null, error: null as { message: string } | null },
  adAccountsResult: {
    data: [] as Array<{ account_id: string }> | null,
    error: null as { message: string } | null,
  },
}));

vi.mock('@/lib/security/cron-auth', () => ({
  verifyCronAuth: () => ({ authorised: true }),
}));

vi.mock('@/lib/campaigns/performance-sync', () => ({
  syncMetaCampaignPerformance: mocks.syncMetaCampaignPerformance,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'meta_campaigns') {
        const query = {
          select: () => query,
          not: () => query,
          in: async () => ({
            data: [
              { id: 'camp-live', account_id: 'brand-live' },
              { id: 'camp-gone', account_id: 'brand-offboarded' },
              { id: 'camp-disconnected', account_id: 'brand-disconnected' },
            ],
            error: null,
          }),
        };
        return query;
      }
      if (table === 'accounts') {
        const query = { select: () => query, not: async () => mocks.accountsResult };
        return query;
      }
      if (table === 'meta_ad_accounts') {
        const query = { select: () => query, eq: async () => mocks.adAccountsResult };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { GET } from '@/app/api/cron/sync-meta-campaigns/route';

describe('sync-meta-campaigns cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncMetaCampaignPerformance.mockResolvedValue(undefined);
    mocks.accountsResult = { data: [{ id: 'brand-offboarded' }], error: null };
    mocks.adAccountsResult = { data: [{ account_id: 'brand-live' }, { account_id: 'brand-offboarded' }], error: null };
  });

  it("skips an offboarded brand's campaigns, whose ads token was deleted on purpose", async () => {
    const response = await GET(new Request('https://example.test/api/cron/sync-meta-campaigns'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 1, failed: 0, failedCampaignIds: [] });
    expect(mocks.syncMetaCampaignPerformance).toHaveBeenCalledTimes(1);
    expect(mocks.syncMetaCampaignPerformance).toHaveBeenCalledWith('camp-live', expect.anything());
  });

  it("skips a brand that disconnected Meta Ads, so its campaigns do not fail every day", async () => {
    const response = await GET(new Request('https://example.test/api/cron/sync-meta-campaigns'));

    expect(await response.json()).toEqual({ synced: 1, failed: 0, failedCampaignIds: [] });
    expect(mocks.syncMetaCampaignPerformance).not.toHaveBeenCalledWith('camp-disconnected', expect.anything());
  });

  it('fails visibly when it cannot tell which brands have Meta Ads set up', async () => {
    mocks.adAccountsResult = { data: null, error: { message: 'meta_ad_accounts down' } };

    const response = await GET(new Request('https://example.test/api/cron/sync-meta-campaigns'));

    expect(response.status).toBe(500);
    expect(mocks.syncMetaCampaignPerformance).not.toHaveBeenCalled();
  });

  it('fails visibly when it cannot tell which brands are offboarded', async () => {
    mocks.accountsResult = { data: null, error: { message: 'accounts down' } };

    const response = await GET(new Request('https://example.test/api/cron/sync-meta-campaigns'));

    expect(response.status).toBe(500);
    expect(mocks.syncMetaCampaignPerformance).not.toHaveBeenCalled();
  });
});
