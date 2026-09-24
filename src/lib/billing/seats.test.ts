import { describe, expect, it, vi } from 'vitest';

import { getSeatLimit } from '@/lib/billing/seats';

type Result = { data: unknown; error: unknown };

function service(account: Result, subscription: Result = { data: null, error: null }) {
  return {
    from: vi.fn((table: string) => {
      const result = table === 'accounts' ? account : subscription;
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) chain[m] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn().mockResolvedValue(result);
      return chain;
    }),
  };
}

const plain = { data: { billing_override: null }, error: null };

describe('getSeatLimit', () => {
  it('is unlimited for comped brands', async () => {
    expect(await getSeatLimit(service({ data: { billing_override: 'comped' }, error: null }) as never, 'b')).toBeNull();
  });

  it('allows no new people while suspended', async () => {
    expect(await getSeatLimit(service({ data: { billing_override: 'suspended' }, error: null }) as never, 'b')).toBe(0);
  });

  it('uses the subscribed plan', async () => {
    expect(await getSeatLimit(service(plain, { data: { plan: 'professional' }, error: null }) as never, 'b')).toBe(5);
    expect(await getSeatLimit(service(plain, { data: { plan: 'starter' }, error: null }) as never, 'b')).toBe(2);
    expect(await getSeatLimit(service(plain, { data: { plan: 'group' }, error: null }) as never, 'b')).toBeNull();
  });

  it('treats a brand without a subscription as on the trial plan (Starter)', async () => {
    expect(await getSeatLimit(service(plain) as never, 'b')).toBe(2);
  });

  it('fails closed when a lookup fails', async () => {
    await expect(getSeatLimit(service({ data: null, error: { message: 'db down' } }) as never, 'b')).rejects.toThrow('db down');
    await expect(getSeatLimit(service(plain, { data: null, error: { message: 'no table' } }) as never, 'b')).rejects.toThrow('no table');
  });
});
