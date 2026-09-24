import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = { billingEnforcement: false };
vi.mock('@/lib/billing/enforcement', () => ({
  BILLING_ENFORCEMENT_FLAG: 'billing_enforcement',
  isBillingEnforcementEnabled: vi.fn(async () => flags.billingEnforcement),
}));

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockRequireAuthContext() }));

const { assertEntitled, EntitlementError, getBrandEntitlement, requireEntitledContext } = await import(
  '@/lib/billing/entitlement-server'
);

type Result = { data: unknown; error: unknown };

function service(account: Result, subscription: Result = { data: null, error: null }) {
  const from = vi.fn((table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) c[m] = vi.fn(() => c);
    c.maybeSingle = vi.fn().mockResolvedValue(table === 'accounts' ? account : subscription);
    return c;
  });
  return { from };
}

const NOW = new Date('2026-10-15T12:00:00Z');
const plainAccount = { data: { archived_at: null, billing_override: null }, error: null };

beforeEach(() => {
  flags.billingEnforcement = false;
  mockRequireAuthContext.mockReset();
});

describe('getBrandEntitlement', () => {
  it('uses the operator state without asking Stripe', async () => {
    const db = service({ data: { archived_at: null, billing_override: 'comped' }, error: null });
    expect(await getBrandEntitlement(db as never, 'b', NOW)).toBe('comped');
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('uses the newest subscription', async () => {
    expect(await getBrandEntitlement(service(plainAccount, { data: { status: 'active', current_period_end: null }, error: null }) as never, 'b', NOW)).toBe('active');
    expect(await getBrandEntitlement(service(plainAccount, { data: { status: 'canceled', current_period_end: null }, error: null }) as never, 'b', NOW)).toBe('lapsed');
  });

  it('treats a brand with no subscription as not set up', async () => {
    expect(await getBrandEntitlement(service(plainAccount) as never, 'b', NOW)).toBe('incomplete');
  });

  it('throws on lookup failure or a missing brand (never a silent pass)', async () => {
    await expect(getBrandEntitlement(service({ data: null, error: { message: 'db down' } }) as never, 'b', NOW)).rejects.toThrow('db down');
    await expect(getBrandEntitlement(service({ data: null, error: null }) as never, 'b', NOW)).rejects.toThrow('brand not found');
    await expect(getBrandEntitlement(service(plainAccount, { data: null, error: { message: 'no table' } }) as never, 'b', NOW)).rejects.toThrow('no table');
  });
});

describe('assertEntitled', () => {
  it('does nothing, and reads nothing, while enforcement is off', async () => {
    const db = service({ data: null, error: { message: 'would fail' } });
    await expect(assertEntitled({ supabase: db as never, accountId: 'b' }, 'create')).resolves.toBeUndefined();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('refuses a held brand when enforcement is on, with the owner-facing reason', async () => {
    flags.billingEnforcement = true;
    const db = service(plainAccount, { data: { status: 'unpaid', current_period_end: null }, error: null });
    const error = await assertEntitled({ supabase: db as never, accountId: 'b' }, 'create').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntitlementError);
    expect((error as Error).message).toMatch(/on hold because its subscription has lapsed/);
  });

  it('lets a held brand still reach billing and export', async () => {
    flags.billingEnforcement = true;
    const db = service(plainAccount);
    await expect(assertEntitled({ supabase: db as never, accountId: 'b' }, 'billing')).resolves.toBeUndefined();
    await expect(assertEntitled({ supabase: db as never, accountId: 'b' }, 'export')).resolves.toBeUndefined();
  });

  it('lets comped and paying brands create', async () => {
    flags.billingEnforcement = true;
    await expect(assertEntitled({ supabase: service({ data: { archived_at: null, billing_override: 'comped' }, error: null }) as never, accountId: 'b' }, 'create')).resolves.toBeUndefined();
    await expect(assertEntitled({ supabase: service(plainAccount, { data: { status: 'trialing', current_period_end: null }, error: null }) as never, accountId: 'b' }, 'publish')).resolves.toBeUndefined();
  });
});

describe('requireEntitledContext', () => {
  it('checks the brand from the verified auth context', async () => {
    flags.billingEnforcement = true;
    const db = service({ data: { archived_at: null, billing_override: 'suspended' }, error: null });
    mockRequireAuthContext.mockResolvedValue({ accountId: 'brand-x', supabase: db });
    await expect(requireEntitledContext('create')).rejects.toThrow('This brand is on hold. Contact CheersAI support.');
  });
});
