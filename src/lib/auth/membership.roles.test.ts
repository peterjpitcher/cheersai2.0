import { describe, expect, it, vi } from 'vitest';

import { loadBrands } from '@/lib/auth/membership';

const accounts = [
  { id: 'a', business_name: 'Alpha', timezone: 'Europe/London', paid_ads_enabled: false, tournaments_enabled: false, management_import_enabled: false },
  { id: 'b', business_name: 'Bravo', timezone: 'Europe/London', paid_ads_enabled: false, tournaments_enabled: false, management_import_enabled: false },
];

function service(memberships: Array<{ account_id: string; role: string }>) {
  return {
    from: vi.fn((table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order']) c[m] = vi.fn(() => c);
      c.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === 'account_members' ? memberships : accounts, error: null });
      return c;
    }),
  };
}

describe('loadBrands roles', () => {
  it('gives each brand the user\'s own role in it', async () => {
    const brands = await loadBrands(service([{ account_id: 'a', role: 'owner' }, { account_id: 'b', role: 'member' }]) as never, 'user-1', false);
    expect(brands.map((b) => [b.accountId, b.role])).toEqual([['a', 'owner'], ['b', 'member']]);
  });

  it('treats super-admins as owner everywhere', async () => {
    const brands = await loadBrands(service([]) as never, 'admin-1', true);
    expect(brands.every((b) => b.role === 'owner')).toBe(true);
  });
});
