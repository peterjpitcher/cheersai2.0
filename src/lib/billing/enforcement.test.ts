import { describe, expect, it, vi } from 'vitest';

// tests/setup.ts mocks this module globally (enforcement off); test the real one.
vi.unmock('@/lib/billing/enforcement');
const { isBillingEnforcementEnabled } = await import('@/lib/billing/enforcement');

function service(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  return { from: vi.fn(() => c) };
}

describe('isBillingEnforcementEnabled', () => {
  it('reads the shared app_flags switch', async () => {
    expect(await isBillingEnforcementEnabled(service({ data: { enabled: true }, error: null }) as never)).toBe(true);
    expect(await isBillingEnforcementEnabled(service({ data: { enabled: false }, error: null }) as never)).toBe(false);
  });

  it('treats a missing row as off', async () => {
    expect(await isBillingEnforcementEnabled(service({ data: null, error: null }) as never)).toBe(false);
  });

  it('throws on a read error so guarded actions fail rather than skip the check', async () => {
    await expect(isBillingEnforcementEnabled(service({ data: null, error: { message: 'db down' } }) as never)).rejects.toThrow('db down');
  });
});
