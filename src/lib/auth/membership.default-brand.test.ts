import { describe, expect, it, vi } from 'vitest';

import { AuthDependencyError } from '@/lib/auth/errors';
import { loadBrands, resolveActiveBrand } from '@/lib/auth/membership';

/**
 * The default brand is the brand a person joined first (spec §4.6), so a new
 * membership, or a new brand a super-admin can see, never changes it. The
 * cookie still wins when it names a brand the person can reach.
 */

function account(id: string, name: string) {
  return { id, business_name: name, timezone: 'Europe/London', paid_ads_enabled: false, tournaments_enabled: false, management_import_enabled: false };
}

/** Accounts come back ordered by name, as the real query asks. */
function service(options: {
  memberships: Array<{ account_id: string; role: string; created_at: string }>;
  accounts: ReturnType<typeof account>[];
  membershipError?: unknown;
}) {
  const sorted = [...options.accounts].sort((a, b) => a.business_name.localeCompare(b.business_name));
  return {
    from: vi.fn((table: string) => {
      const c: Record<string, unknown> = {};
      let ids: string[] | null = null;
      for (const m of ['select', 'eq', 'is', 'order']) c[m] = vi.fn(() => c);
      c.in = vi.fn((_column: string, values: string[]) => {
        ids = values;
        return c;
      });
      c.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'account_members') {
          return resolve(options.membershipError ? { data: null, error: options.membershipError } : { data: options.memberships, error: null });
        }
        return resolve({ data: ids ? sorted.filter((a) => ids!.includes(a.id)) : sorted, error: null });
      };
      return c;
    }),
  };
}

const ANCHOR = account('anchor', 'The Anchor');
const OJ = account('oj', 'Orange Jelly');
const TEST = account('test', 'Cheers Test Venue');
const STRANGER = account('stranger', 'A Anchor');

describe('default brand for an ordinary user', () => {
  it('is the brand they joined first, not the first by name', async () => {
    const brands = await loadBrands(
      service({
        memberships: [
          { account_id: 'anchor', role: 'member', created_at: '2026-07-14T14:13:00.000000+00:00' },
          { account_id: 'test', role: 'owner', created_at: '2026-09-28T09:02:00.000000+00:00' },
        ],
        accounts: [ANCHOR, TEST],
      }) as never,
      'user-1',
      false,
    );
    // Display order stays alphabetical.
    expect(brands.map((b) => b.name)).toEqual(['Cheers Test Venue', 'The Anchor']);
    expect(resolveActiveBrand(brands, null)?.accountId).toBe('anchor');
  });

  it('does not change when they accept a new membership in a brand named to sort first', async () => {
    const before = await loadBrands(
      service({
        memberships: [{ account_id: 'anchor', role: 'member', created_at: '2026-07-14T14:13:00+00:00' }],
        accounts: [ANCHOR, STRANGER],
      }) as never,
      'user-1',
      false,
    );
    const after = await loadBrands(
      service({
        memberships: [
          { account_id: 'anchor', role: 'member', created_at: '2026-07-14T14:13:00+00:00' },
          { account_id: 'stranger', role: 'member', created_at: '2026-10-01T08:00:00+00:00' },
        ],
        accounts: [ANCHOR, STRANGER],
      }) as never,
      'user-1',
      false,
    );
    expect(after[0].name).toBe('A Anchor');
    expect(resolveActiveBrand(before, null)?.accountId).toBe('anchor');
    expect(resolveActiveBrand(after, null)?.accountId).toBe('anchor');
  });

  it('still follows the cookie when it names one of their brands', async () => {
    const brands = await loadBrands(
      service({
        memberships: [
          { account_id: 'anchor', role: 'member', created_at: '2026-07-14T14:13:00+00:00' },
          { account_id: 'stranger', role: 'member', created_at: '2026-10-01T08:00:00+00:00' },
        ],
        accounts: [ANCHOR, STRANGER],
      }) as never,
      'user-1',
      false,
    );
    expect(resolveActiveBrand(brands, 'stranger')?.accountId).toBe('stranger');
    // A cookie for a brand they cannot reach is ignored.
    expect(resolveActiveBrand(brands, 'oj')?.accountId).toBe('anchor');
  });
});

describe('default brand for a super-admin', () => {
  const memberships = [
    { account_id: 'anchor', role: 'owner', created_at: '2026-07-14T14:13:00+00:00' },
    { account_id: 'test', role: 'owner', created_at: '2026-09-28T09:02:00+00:00' },
  ];

  it('is their own first membership, ahead of brands they only see as super-admin', async () => {
    const brands = await loadBrands(service({ memberships, accounts: [ANCHOR, OJ, TEST] }) as never, 'peter', true);
    expect(brands.map((b) => b.name)).toEqual(['Cheers Test Venue', 'Orange Jelly', 'The Anchor']);
    expect(brands.find((b) => b.accountId === 'oj')?.joinedAt).toBeNull();
    expect(brands.every((b) => b.role === 'owner')).toBe(true);
    expect(resolveActiveBrand(brands, null)?.accountId).toBe('anchor');
  });

  it('does not change when a new brand appears that sorts first', async () => {
    const brands = await loadBrands(service({ memberships, accounts: [ANCHOR, OJ, TEST, STRANGER] }) as never, 'peter', true);
    expect(brands[0].name).toBe('A Anchor');
    expect(resolveActiveBrand(brands, null)?.accountId).toBe('anchor');
  });

  it('does not change when they join a new brand', async () => {
    const brands = await loadBrands(
      service({
        memberships: [...memberships, { account_id: 'stranger', role: 'owner', created_at: '2026-10-02T10:00:00+00:00' }],
        accounts: [ANCHOR, OJ, TEST, STRANGER],
      }) as never,
      'peter',
      true,
    );
    expect(resolveActiveBrand(brands, null)?.accountId).toBe('anchor');
  });

  it('falls back to the first by name when they belong to no brand', async () => {
    const brands = await loadBrands(service({ memberships: [], accounts: [ANCHOR, OJ] }) as never, 'admin-2', true);
    expect(resolveActiveBrand(brands, null)?.name).toBe('Orange Jelly');
  });

  it('fails closed (dependency error) when memberships cannot be read', async () => {
    await expect(
      loadBrands(service({ memberships, accounts: [ANCHOR], membershipError: { message: 'db down' } }) as never, 'peter', true),
    ).rejects.toBeInstanceOf(AuthDependencyError);
  });
});

describe('resolveActiveBrand edge cases', () => {
  it('returns null with no brands', () => {
    expect(resolveActiveBrand([], null)).toBeNull();
  });

  it('keeps name order on a tie and ignores unreadable dates', () => {
    const base = { timezone: 'Europe/London', features: { paidAds: false, tournaments: false, managementImport: false }, role: 'owner' as const };
    const brands = [
      { ...base, accountId: 'a', name: 'Alpha', joinedAt: '2026-07-14T14:13:00Z' },
      { ...base, accountId: 'b', name: 'Bravo', joinedAt: '2026-07-14T14:13:00Z' },
      { ...base, accountId: 'c', name: 'Charlie', joinedAt: 'not a date' },
    ];
    expect(resolveActiveBrand(brands, null)?.accountId).toBe('a');
  });
});
