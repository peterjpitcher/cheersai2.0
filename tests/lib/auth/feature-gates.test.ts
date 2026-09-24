import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand with every feature switch off (a new customer) must not be able to
 * reach paid ads, tournaments or the management-app import through any
 * server action, even by calling it directly. Pausing a campaign stays open so
 * live ad spend can always be stopped.
 */

const OFF = { paidAds: false, tournaments: false, managementImport: false };
const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockRequireAuthContext() }));

// Any database access would mean a guard let the call through.
const mockServiceClient = vi.fn(() => {
  throw new Error('database must not be touched');
});
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => mockServiceClient(),
  tryCreateServiceSupabaseClient: () => mockServiceClient(),
}));

beforeEach(() => {
  mockServiceClient.mockClear();
  mockRequireAuthContext.mockResolvedValue({
    accountId: 'new-venue',
    activeAccountId: 'new-venue',
    isSuperAdmin: false,
    user: { id: 'owner-1' },
    features: OFF,
    supabase: { from: () => { throw new Error('database must not be touched'); } },
  });
});

describe('feature gates for a brand with every switch off', () => {
  it('paid ads: campaign actions refuse', async () => {
    const { getCampaigns, deleteCampaign } = await import('@/app/(app)/campaigns/actions');
    await expect(getCampaigns()).rejects.toThrow('This brand doesn\'t have paid ads switched on.');
    await expect(deleteCampaign('c-1')).rejects.toThrow('This brand doesn\'t have paid ads switched on.');
  });

  it('paid ads: connecting an ads account refuses', async () => {
    const { startAdsOAuth } = await import('@/app/(app)/connections/actions-ads');
    await expect(startAdsOAuth()).rejects.toThrow('This brand doesn\'t have paid ads switched on.');
  });

  it('paid ads: publishing refuses but pausing stays available', async () => {
    const { publishCampaign, pauseCampaign } = await import('@/app/(app)/campaigns/[id]/actions');
    await expect(publishCampaign('c-1')).rejects.toThrow('This brand doesn\'t have paid ads switched on.');
    // pauseCampaign gets past the gate and reaches the database.
    await expect(pauseCampaign('c-1')).rejects.toThrow('database must not be touched');
  });

  it('tournaments: actions refuse without touching the database', async () => {
    const { deleteTournament } = await import('@/app/actions/tournament');
    expect(await deleteTournament('t-1')).toEqual({
      success: false,
      error: 'This brand doesn\'t have tournaments switched on.',
    });
    const { getTournamentBaseImageUploads } = await import('@/app/actions/tournament-images');
    await expect(getTournamentBaseImageUploads('6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f')).rejects.toThrow(
      'This brand doesn\'t have tournaments switched on.',
    );
  });

  it('management import: the connection lookup refuses', async () => {
    const { getManagementConnectionConfig } = await import('@/lib/management-app/data');
    await expect(getManagementConnectionConfig()).rejects.toThrow(
      'This brand doesn\'t have management app import switched on.',
    );
    expect(mockServiceClient).not.toHaveBeenCalled();
  });
});
