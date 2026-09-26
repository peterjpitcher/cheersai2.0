import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBillingDb } from '../../../../tests/helpers/in-memory-billing-db';
import { billingServerEnv, createFakeStripe, fakeSubscription, TEST_PORTAL_CONFIGURATION, TEST_PRICES, type FakeStripe } from '../../../../tests/helpers/fake-stripe';

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } } }));

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ createLogger: () => logger }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockRequireAuthContext() }));

const stripeRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/billing/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/stripe')>()),
  getStripe: () => stripeRef.current,
}));

const mockReconcile = vi.fn();
vi.mock('@/lib/billing/reconcile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/reconcile')>()),
  reconcileBrandFromStripe: (...args: unknown[]) => mockReconcile(...args),
}));

const { startCheckout, openBillingPortal, checkBillingAgain } = await import('./billing-actions');

const OWNER = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const BRAND = '2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e';
const NOT_SET_UP = 'Billing is not set up yet. Please contact Cheers support.';

let db: InMemoryBillingDb;
let fake: FakeStripe;

function ctx(role: 'owner' | 'member' = 'owner') {
  return { user: { id: OWNER, email: 'owner@newvenue.test' }, accountId: BRAND, activeAccountId: BRAND, supabase: db.client(), role };
}

function setBrand(values: Record<string, unknown>) {
  Object.assign(db.tables.accounts[0], values);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(serverEnv)) delete serverEnv[key];
  Object.assign(serverEnv, billingServerEnv());
  db = new InMemoryBillingDb();
  db.seed('accounts', [{ id: BRAND, business_name: 'The New Venue', email: 'hello@newvenue.test', billing_override: null }]);
  fake = createFakeStripe();
  stripeRef.current = fake.stripe;
  mockRequireAuthContext.mockResolvedValue(ctx());
});

describe('startCheckout: who and which brands may start it', () => {
  it('refuses a member, without touching Stripe', async () => {
    mockRequireAuthContext.mockResolvedValue(ctx('member'));
    expect(await startCheckout({ plan: 'starter', interval: 'month' })).toEqual({ error: 'Only an owner of this brand can do that.' });
    expect(fake.customersCreate).not.toHaveBeenCalled();
    expect(fake.sessionsCreate).not.toHaveBeenCalled();
  });

  it('refuses a comped brand: it never needs to pay', async () => {
    setBrand({ billing_override: 'comped' });
    expect((await startCheckout({ plan: 'starter', interval: 'month' })).error).toMatch(/included free of charge/);
    expect(fake.customersCreate).not.toHaveBeenCalled();
    expect(fake.sessionsCreate).not.toHaveBeenCalled();
    expect(db.rows('billing_customers')).toHaveLength(0);
  });

  it('refuses a suspended or closed brand', async () => {
    setBrand({ billing_override: 'suspended' });
    expect((await startCheckout({ plan: 'starter', interval: 'month' })).error).toMatch(/on hold/);
    setBrand({ billing_override: null, archived_at: '2026-09-01T00:00:00Z' });
    expect((await startCheckout({ plan: 'starter', interval: 'month' })).error).toMatch(/closed/);
    expect(fake.sessionsCreate).not.toHaveBeenCalled();
  });

  it('refuses a brand that already has a live subscription and points to Manage billing', async () => {
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_test_existing' }]);
    fake.subscriptions.push(fakeSubscription({ customer: 'cus_test_existing', status: 'trialing' }));
    const result = await startCheckout({ plan: 'professional', interval: 'month' });
    expect(result.error).toMatch(/already has a subscription.*Manage billing/);
    expect(fake.sessionsCreate).not.toHaveBeenCalled();
  });
});

describe('startCheckout: never trusts the browser for money', () => {
  it('rejects a browser-supplied price id', async () => {
    const withPrice = { plan: 'starter', interval: 'month', price: 'price_evil_1p' } as unknown as Parameters<typeof startCheckout>[0];
    expect(await startCheckout(withPrice)).toEqual({ error: 'Choose a plan and a billing period.' });
    const priceAsPlan = { plan: TEST_PRICES.professionalAnnual, interval: 'year' } as unknown as Parameters<typeof startCheckout>[0];
    expect(await startCheckout(priceAsPlan)).toEqual({ error: 'Choose a plan and a billing period.' });
    const group = { plan: 'group', interval: 'month' } as unknown as Parameters<typeof startCheckout>[0];
    expect(await startCheckout(group)).toEqual({ error: 'Choose a plan and a billing period.' });
    expect(fake.sessionsCreate).not.toHaveBeenCalled();
  });

  it('uses the server price for the chosen plan and period', async () => {
    await startCheckout({ plan: 'professional', interval: 'year' });
    const [params] = fake.sessionsCreate.mock.calls[0] as [{ line_items: Array<{ price: string; quantity: number }> }];
    expect(params.line_items).toEqual([{ price: TEST_PRICES.professionalAnnual, quantity: 1 }]);
  });
});

describe('startCheckout: the Checkout Session', () => {
  it('creates and stores the Stripe customer before starting Checkout, with the full trial and tax setup', async () => {
    let customerRowAtCheckout: unknown[] = [];
    fake.sessionsCreate.mockImplementationOnce(async () => {
      customerRowAtCheckout = db.rows('billing_customers');
      return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
    });

    const result = await startCheckout({ plan: 'starter', interval: 'month' });

    expect(result).toEqual({ success: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(fake.customersCreate).toHaveBeenCalledWith(
      { name: 'The New Venue', email: 'owner@newvenue.test', metadata: { app: 'cheersai', account_id: BRAND } },
      { idempotencyKey: `cheersai-customer-${BRAND}` },
    );
    expect(customerRowAtCheckout).toEqual([expect.objectContaining({ account_id: BRAND, stripe_customer_id: 'cus_test_new' })]);

    const [params, options] = fake.sessionsCreate.mock.calls[0] as [Record<string, unknown>, { idempotencyKey: string }];
    const metadata = { app: 'cheersai', account_id: BRAND, plan: 'starter', interval: 'month' };
    expect(params).toEqual({
      mode: 'subscription',
      customer: 'cus_test_new',
      client_reference_id: BRAND,
      line_items: [{ price: TEST_PRICES.starterMonthly, quantity: 1 }],
      payment_method_collection: 'always',
      subscription_data: { trial_period_days: 14, metadata },
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { name: 'auto', address: 'auto' },
      metadata,
      success_url: 'https://cheers.orangejelly.co.uk/settings?checkout=success',
      cancel_url: 'https://cheers.orangejelly.co.uk/settings?checkout=cancelled',
    });
    expect(options.idempotencyKey).toMatch(new RegExp(`^cheersai-checkout-${BRAND}-`));
  });

  it('uses a fresh idempotency key for each attempt and reuses the stored customer', async () => {
    await startCheckout({ plan: 'starter', interval: 'month' });
    await startCheckout({ plan: 'starter', interval: 'month' });
    expect(fake.customersCreate).toHaveBeenCalledTimes(1);
    const keys = fake.sessionsCreate.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('gives no second free trial to a brand that has subscribed before', async () => {
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_test_existing' }]);
    fake.subscriptions.push(fakeSubscription({ customer: 'cus_test_existing', status: 'canceled' }));
    await startCheckout({ plan: 'starter', interval: 'month' });
    const [params] = fake.sessionsCreate.mock.calls[0] as [{ subscription_data: Record<string, unknown> }];
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('expires an unfinished CheersAI Checkout first so only one can complete', async () => {
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_test_existing' }]);
    fake.openSessions.push({ id: 'cs_test_old', metadata: { app: 'cheersai' } }, { id: 'cs_test_other_app', metadata: {} });
    await startCheckout({ plan: 'starter', interval: 'month' });
    expect(fake.sessionsExpire).toHaveBeenCalledTimes(1);
    expect(fake.sessionsExpire).toHaveBeenCalledWith('cs_test_old');
  });
});

describe('startCheckout: failures reach the owner', () => {
  it('says billing is not set up when the Stripe settings are missing', async () => {
    delete serverEnv.STRIPE_SECRET_KEY;
    expect(await startCheckout({ plan: 'starter', interval: 'month' })).toEqual({ error: NOT_SET_UP });
    serverEnv.STRIPE_SECRET_KEY = 'sk_test_unit';
    delete serverEnv.STRIPE_PRICE_STARTER_ANNUAL;
    expect(await startCheckout({ plan: 'starter', interval: 'month' })).toEqual({ error: NOT_SET_UP });
    expect(fake.sessionsCreate).not.toHaveBeenCalled();
  });

  it('shows an error when Stripe is down', async () => {
    fake.sessionsCreate.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    const result = await startCheckout({ plan: 'starter', interval: 'month' });
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/Could not start checkout/);
    expect(logger.error).toHaveBeenCalled();
  });

  it('shows an error, and starts no Checkout, when the customer cannot be saved', async () => {
    db.fail('billing_customers', 'insert');
    const result = await startCheckout({ plan: 'starter', interval: 'month' });
    expect(result.error).toMatch(/Could not start checkout/);
    expect(fake.sessionsCreate).not.toHaveBeenCalled();
  });

  it('shows an error when the database is down', async () => {
    db.fail('accounts', 'select');
    expect((await startCheckout({ plan: 'starter', interval: 'month' })).error).toMatch(/Could not start checkout/);
    expect(fake.customersCreate).not.toHaveBeenCalled();
  });
});

describe('openBillingPortal', () => {
  it('opens CheersAI\'s own portal configuration for the brand\'s customer', async () => {
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_test_existing' }]);
    expect(await openBillingPortal()).toEqual({ success: true, url: 'https://billing.stripe.com/p/session/test_1' });
    expect(fake.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_test_existing',
      configuration: TEST_PORTAL_CONFIGURATION,
      return_url: 'https://cheers.orangejelly.co.uk/settings',
    });
  });

  it('refuses a member and a brand with no billing account', async () => {
    mockRequireAuthContext.mockResolvedValue(ctx('member'));
    expect((await openBillingPortal()).error).toMatch(/Only an owner/);
    mockRequireAuthContext.mockResolvedValue(ctx());
    expect((await openBillingPortal()).error).toMatch(/no billing account yet/);
    expect(fake.portalCreate).not.toHaveBeenCalled();
  });

  it('says billing is not set up without the portal configuration', async () => {
    delete serverEnv.STRIPE_PORTAL_CONFIGURATION_ID;
    expect(await openBillingPortal()).toEqual({ error: NOT_SET_UP });
  });

  it('shows an error when Stripe is down', async () => {
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_test_existing' }]);
    fake.portalCreate.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    expect((await openBillingPortal()).error).toMatch(/Could not open billing/);
  });
});

describe('checkBillingAgain', () => {
  it('reconciles the owner\'s active brand from Stripe', async () => {
    mockReconcile.mockResolvedValue({ outcome: 'synced', state: 'trialing' });
    expect(await checkBillingAgain()).toEqual({ success: true, state: 'trialing' });
    expect(mockReconcile).toHaveBeenCalledWith(BRAND, expect.objectContaining({ service: expect.anything() }));
  });

  it('shows an error when Stripe or the database is down', async () => {
    mockReconcile.mockRejectedValue(new Error('down'));
    expect((await checkBillingAgain()).error).toMatch(/Could not check with Stripe/);
  });

  it('refuses a member', async () => {
    mockRequireAuthContext.mockResolvedValue(ctx('member'));
    expect((await checkBillingAgain()).error).toMatch(/Only an owner/);
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});
