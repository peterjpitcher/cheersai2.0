import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockRequireAuthContext() }));

const { FeatureUnavailableError, hasFeature, requireFeatureContext } = await import('@/lib/auth/features');

const OFF = { paidAds: false, tournaments: false, managementImport: false };

beforeEach(() => {
  mockRequireAuthContext.mockReset();
});

describe('hasFeature', () => {
  it('is true only for a switch that is explicitly on', () => {
    expect(hasFeature({ features: { ...OFF, paidAds: true } }, 'paidAds')).toBe(true);
    expect(hasFeature({ features: OFF }, 'paidAds')).toBe(false);
    expect(hasFeature({ features: { ...OFF, tournaments: true } }, 'managementImport')).toBe(false);
  });
});

describe('requireFeatureContext', () => {
  it('returns the auth context when the active brand has the feature', async () => {
    const ctx = { accountId: 'brand-1', features: { ...OFF, tournaments: true } };
    mockRequireAuthContext.mockResolvedValue(ctx);
    await expect(requireFeatureContext('tournaments')).resolves.toBe(ctx);
  });

  it.each(['paidAds', 'tournaments', 'managementImport'] as const)(
    'fails closed for %s when the switch is off',
    async (feature) => {
      mockRequireAuthContext.mockResolvedValue({ accountId: 'brand-1', features: OFF });
      await expect(requireFeatureContext(feature)).rejects.toBeInstanceOf(FeatureUnavailableError);
    },
  );

  it('gives super-admins no bypass: they see what the brand sees', async () => {
    mockRequireAuthContext.mockResolvedValue({ accountId: 'brand-1', isSuperAdmin: true, features: OFF });
    await expect(requireFeatureContext('paidAds')).rejects.toThrow('This brand doesn\'t have paid ads switched on.');
  });
});
