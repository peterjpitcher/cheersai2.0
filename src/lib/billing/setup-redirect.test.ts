import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCurrentUser = vi.fn();
vi.mock('@/lib/auth/server', () => ({ getCurrentUser: () => mockGetCurrentUser() }));
const mockEntitlement = vi.fn();
vi.mock('@/lib/billing/entitlement-server', () => ({ getBrandEntitlement: (...a: unknown[]) => mockEntitlement(...a) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({}) }));

const { destinationAfterPasswordSet } = await import('./setup-redirect');

const BRAND = '2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockGetCurrentUser.mockResolvedValue({ id: 'u1', activeAccountId: BRAND, role: 'owner' });
});

describe('destinationAfterPasswordSet (spec §4.4)', () => {
  it('sends an owner of a brand without billing to the Billing section', async () => {
    mockEntitlement.mockResolvedValue('incomplete');
    expect(await destinationAfterPasswordSet()).toBe('/settings#billing');
    expect(mockEntitlement).toHaveBeenCalledWith(expect.anything(), BRAND);
  });

  it('never sends a comped brand to billing', async () => {
    mockEntitlement.mockResolvedValue('comped');
    expect(await destinationAfterPasswordSet()).toBe('/planner');
  });

  it('sends paying and trial brands to the planner', async () => {
    mockEntitlement.mockResolvedValue('trialing');
    expect(await destinationAfterPasswordSet()).toBe('/planner');
    mockEntitlement.mockResolvedValue('active');
    expect(await destinationAfterPasswordSet()).toBe('/planner');
  });

  it('sends a member to the planner without looking up billing', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u2', activeAccountId: BRAND, role: 'member' });
    expect(await destinationAfterPasswordSet()).toBe('/planner');
    expect(mockEntitlement).not.toHaveBeenCalled();
  });

  it('falls back to the planner when a lookup fails', async () => {
    mockEntitlement.mockRejectedValue(new Error('db down'));
    expect(await destinationAfterPasswordSet()).toBe('/planner');
    mockGetCurrentUser.mockRejectedValue(new Error('auth down'));
    expect(await destinationAfterPasswordSet()).toBe('/planner');
  });
});
