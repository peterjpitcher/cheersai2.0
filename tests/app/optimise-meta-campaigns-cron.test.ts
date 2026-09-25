import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMetaAdAccountTokens: vi.fn(),
  runMetaCampaignOptimisation: vi.fn(),
  syncMetaCampaignPerformance: vi.fn(),
}));

vi.mock('@/lib/security/cron-auth', () => ({
  verifyCronAuth: () => ({ authorised: true }),
}));

vi.mock('@/lib/meta/ad-account-tokens', () => ({
  getMetaAdAccountTokens: mocks.getMetaAdAccountTokens,
}));

vi.mock('@/lib/campaigns/optimisation', () => ({
  runMetaCampaignOptimisation: mocks.runMetaCampaignOptimisation,
}));

vi.mock('@/lib/campaigns/performance-sync', () => ({
  syncMetaCampaignPerformance: mocks.syncMetaCampaignPerformance,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'meta_ad_accounts') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ account_id: 'with-token' }, { account_id: 'without-token' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'meta_campaigns') {
        const query = {
          select: () => query,
          eq: () => query,
          not: () => query,
          in: async () => ({ data: [], error: null }),
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { GET } from '@/app/api/cron/optimise-meta-campaigns/route';

describe('optimise-meta-campaigns cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMetaAdAccountTokens.mockImplementation(async (_client: unknown, accountId: string) => ({
      accessToken: accountId === 'with-token' ? 'token' : null,
      conversionsApiToken: null,
    }));
    mocks.runMetaCampaignOptimisation.mockResolvedValue({
      evaluatedAdSets: 0,
      plannedActions: 0,
      appliedActions: 0,
      failedActions: 0,
    });
  });

  it('skips brands with no stored access token, as the old plaintext filter did', async () => {
    const response = await GET(new Request('https://cheers.test/api/cron/optimise-meta-campaigns'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts).toBe(1);
    expect(mocks.runMetaCampaignOptimisation).toHaveBeenCalledTimes(1);
    expect(mocks.runMetaCampaignOptimisation).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'with-token' }));
  });

  it('records a brand whose token cannot be read as a failure instead of skipping it', async () => {
    mocks.getMetaAdAccountTokens.mockRejectedValueOnce(new Error('token could not be decrypted'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(new Request('https://cheers.test/api/cron/optimise-meta-campaigns'));
    const body = await response.json();

    expect(body.results).toContainEqual({ accountId: 'with-token', error: 'token could not be decrypted' });
  });
});
