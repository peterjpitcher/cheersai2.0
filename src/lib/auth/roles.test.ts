import { describe, expect, it } from 'vitest';

import { ownedBrandIds, ownsBrand } from '@/lib/auth/roles';
import type { BrandSummary } from '@/lib/auth/types';

function brand(accountId: string, role: BrandSummary['role']): BrandSummary {
  return {
    accountId,
    name: accountId,
    timezone: 'Europe/London',
    features: { paidAds: false, tournaments: false, managementImport: false },
    role,
    joinedAt: null,
  };
}

const brands = [brand('owned', 'owner'), brand('joined', 'member')];

describe('ownsBrand', () => {
  it('is true only for a brand the user owns', () => {
    expect(ownsBrand({ brands, isSuperAdmin: false }, 'owned')).toBe(true);
    expect(ownsBrand({ brands, isSuperAdmin: false }, 'joined')).toBe(false);
    expect(ownsBrand({ brands, isSuperAdmin: false }, 'elsewhere')).toBe(false);
  });

  it('is true for a super-admin in any brand', () => {
    expect(ownsBrand({ brands: [], isSuperAdmin: true }, 'elsewhere')).toBe(true);
  });
});

describe('ownedBrandIds', () => {
  it('lists owned brands only, or every listed brand for a super-admin', () => {
    expect(ownedBrandIds({ brands, isSuperAdmin: false })).toEqual(['owned']);
    expect(ownedBrandIds({ brands, isSuperAdmin: true })).toEqual(['owned', 'joined']);
  });
});
