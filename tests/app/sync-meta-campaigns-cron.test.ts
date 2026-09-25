import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncMetaCampaignPerformance: vi.fn(),
  accountsResult: { data: [] as Array<{ id: string }> | null, error: null as { message: string } | null },
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
  });

  it("skips an offboarded brand's campaigns, whose ads token was deleted on purpose", async () => {
    const response = await GET(new Request('https://example.test/api/cron/sync-meta-campaigns'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 1, failed: 0, failedCampaignIds: [] });
    expect(mocks.syncMetaCampaignPerformance).toHaveBeenCalledTimes(1);
    expect(mocks.syncMetaCampaignPerformance).toHaveBeenCalledWith('camp-live', expect.anything());
  });

  it('fails visibly when it cannot tell which brands are offboarded', async () => {
    mocks.accountsResult = { data: null, error: { message: 'accounts down' } };

    const response = await GET(new Request('https://example.test/api/cron/sync-meta-campaigns'));

    expect(response.status).toBe(500);
    expect(mocks.syncMetaCampaignPerformance).not.toHaveBeenCalled();
  });
});
