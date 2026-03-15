import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase — applies to all DB calls inside saveCampaignDraft.
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

// Mock auth — saveCampaignDraft calls requireAuthContext.
vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

// Mock publishCampaign from its own module.
vi.mock('@/app/(app)/campaigns/[id]/actions', () => ({
  publishCampaign: vi.fn(),
}));

// Mock next/cache.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { saveAndPublishCampaign } from '@/app/(app)/campaigns/actions';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// Build a chainable Supabase mock where insert → select → single resolves.
// The payload has no ad_sets so only the meta_campaigns insert is called.
function makeInsertMock(
  campaignData: { id: string } | null,
  insertError: { message: string } | null = null,
) {
  const singleFn = vi.fn().mockResolvedValue({ data: campaignData, error: insertError });
  const selectFn = vi.fn().mockReturnValue({ single: singleFn });
  const insertFn = vi.fn().mockReturnValue({ select: selectFn });
  const fromFn = vi.fn().mockReturnValue({ insert: insertFn, select: selectFn });

  return { from: fromFn };
}

const mockPayload = {
  campaign_name: 'Test Campaign',
  objective: 'OUTCOME_AWARENESS' as const,
  rationale: 'Test rationale',
  special_ad_category: 'NONE' as const,
  ad_sets: [], // no ad sets → simpler mock (no ad_set inserts)
};

const mockMeta = {
  budgetAmount: 500,
  budgetType: 'DAILY' as const,
  startDate: '2026-04-01',
  endDate: '2026-04-10',
  adsStopTime: '22:00',
  problemBrief: 'Test brief',
};

describe('saveAndPublishCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves and publishes — returns { campaignId } on full success', async () => {
    const supabase = makeInsertMock({ id: 'campaign-abc' });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(supabase as never);
    vi.mocked(publishCampaign).mockResolvedValue({ success: true });

    const result = await saveAndPublishCampaign(mockPayload, mockMeta);

    expect(result).toEqual({ campaignId: 'campaign-abc' });
    expect(publishCampaign).toHaveBeenCalledWith('campaign-abc');
  });

  it('returns { campaignId } when publish fails — publishCampaign is called and handles the error write', async () => {
    const supabase = makeInsertMock({ id: 'campaign-abc' });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(supabase as never);
    vi.mocked(publishCampaign).mockResolvedValue({ error: 'Meta rejected the ad creative.' });

    const result = await saveAndPublishCampaign(mockPayload, mockMeta);

    // Campaign was saved — should still redirect.
    expect(result).toEqual({ campaignId: 'campaign-abc' });
    // publishCampaign was called and owns the publish_error write internally.
    expect(publishCampaign).toHaveBeenCalledWith('campaign-abc');
  });

  it('returns { error } immediately when save fails — publishCampaign is never called', async () => {
    const supabase = makeInsertMock(null, { message: 'DB constraint violation' });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(supabase as never);

    const result = await saveAndPublishCampaign(mockPayload, mockMeta);

    expect(result).toEqual({ error: 'DB constraint violation' });
    expect(publishCampaign).not.toHaveBeenCalled();
  });
});
