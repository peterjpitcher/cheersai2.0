import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDecryptedTokenMock } = vi.hoisted(() => ({ getDecryptedTokenMock: vi.fn() }));
vi.mock('@/lib/providers/token-helpers', () => ({ getDecryptedToken: getDecryptedTokenMock }));

import { tokenForPlatform } from '@/lib/analytics/post-results-token';

function db(row: unknown, error: { message: string } | null = null) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
  };
  return { client: { from: vi.fn(() => builder) } as never, filters };
}

beforeEach(() => {
  getDecryptedTokenMock.mockReset();
  getDecryptedTokenMock.mockResolvedValue('fixture-page-token');
});

describe('tokenForPlatform', () => {
  it("decrypts the brand's own token for that platform", async () => {
    const { client, filters } = db({ id: 'conn-1', status: 'active' });
    await expect(tokenForPlatform(client, 'acc-1', 'facebook')).resolves.toBe('fixture-page-token');
    expect(filters).toEqual([['account_id', 'acc-1'], ['provider', 'facebook']]);
    expect(getDecryptedTokenMock).toHaveBeenCalledWith('conn-1', 'access');
  });

  it('treats the dead "expiring" label as connected', async () => {
    await expect(tokenForPlatform(db({ id: 'conn-2', status: 'expiring' }).client, 'acc-1', 'instagram')).resolves.toBe('fixture-page-token');
  });

  it('returns null with no connection, one that needs action, or no stored token', async () => {
    await expect(tokenForPlatform(db(null).client, 'acc-1', 'facebook')).resolves.toBeNull();
    await expect(tokenForPlatform(db({ id: 'conn-3', status: 'needs_action' }).client, 'acc-1', 'facebook')).resolves.toBeNull();
    getDecryptedTokenMock.mockRejectedValue(new Error('Token not found'));
    await expect(tokenForPlatform(db({ id: 'conn-4', status: 'active' }).client, 'acc-1', 'facebook')).resolves.toBeNull();
  });

  it('throws when the connection cannot be read', async () => {
    await expect(tokenForPlatform(db(null, { message: 'timeout' }).client, 'acc-1', 'facebook')).rejects.toThrow('could not be read: timeout');
  });
});
