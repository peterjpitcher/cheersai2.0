import { describe, expect, it } from 'vitest';

import { countCampaignsThatCanSpend } from '@/lib/campaigns/live-spend';

/** Records the query the helper builds, then answers with a fixed result. */
function recordingService(result: { count: number | null; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const q = {
    select: (...args: unknown[]) => (calls.push(['select', ...args]), q),
    eq: (...args: unknown[]) => (calls.push(['eq', ...args]), q),
    or: (...args: unknown[]) => (calls.push(['or', ...args]), q),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: null, ...result }),
  };
  const service = { from: (table: string) => (calls.push(['from', table]), q) };
  return { service: service as never, calls };
}

describe('countCampaignsThatCanSpend', () => {
  it("counts one brand's campaigns that are ACTIVE in the app or at Meta and not past their London end date", async () => {
    const { service, calls } = recordingService({ count: 2, error: null });

    // 23:30 UTC on 30 September is already 1 October in London (BST).
    const count = await countCampaignsThatCanSpend(service, 'brand-1', new Date('2026-09-30T23:30:00Z'));

    expect(count).toBe(2);
    expect(calls).toEqual([
      ['from', 'meta_campaigns'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'account_id', 'brand-1'],
      ['or', 'status.eq.ACTIVE,meta_status.eq.ACTIVE'],
      ['or', 'end_date.is.null,end_date.gte.2026-10-01'],
    ]);
  });

  it('uses the London date in winter too (GMT)', async () => {
    const { service, calls } = recordingService({ count: 0, error: null });

    await countCampaignsThatCanSpend(service, 'brand-1', new Date('2026-12-31T23:30:00Z'));

    expect(calls.at(-1)).toEqual(['or', 'end_date.is.null,end_date.gte.2026-12-31']);
  });

  it('treats a missing count as zero', async () => {
    const { service } = recordingService({ count: null, error: null });
    expect(await countCampaignsThatCanSpend(service, 'brand-1')).toBe(0);
  });

  it('throws when the lookup fails, so callers fail closed', async () => {
    const { service } = recordingService({ count: null, error: { message: 'connection reset' } });
    await expect(countCampaignsThatCanSpend(service, 'brand-1')).rejects.toThrow('meta_campaigns lookup failed: connection reset');
  });
});
