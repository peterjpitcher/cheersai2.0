import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBillingDb } from '../../../tests/helpers/in-memory-billing-db';
import { billingServerEnv, createFakeStripe, fakeSubscription, TEST_PRICES, type FakeStripe } from '../../../tests/helpers/fake-stripe';

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } } }));
const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ createLogger: () => logger }));
const mockDoubleBillingAlert = vi.fn();
vi.mock('@/lib/notifications/operator-alerts', () => ({ alertPossibleDoubleBilling: (...args: unknown[]) => mockDoubleBillingAlert(...args) }));

const { hasLiveCheersSubscription, reconcileBrandFromStripe, ReconcileError } = await import('./reconcile');
const { BillingNotConfiguredError } = await import('./stripe');

const BRAND = '6f1d2c3b-4a59-4e68-8d7c-9b0a1f2e3d4c';
const OTHER_BRAND = '7a2e3d4c-5b6a-4f79-9e8d-0c1b2a3f4e5d';
const CUSTOMER = 'cus_test_brand';
const FETCHED_AT = new Date('2026-09-26T10:00:00.000Z');

let db: InMemoryBillingDb;
let fake: FakeStripe;

function reconcile(now: Date = FETCHED_AT) {
  return reconcileBrandFromStripe(BRAND, { service: db.client(), stripe: fake.stripe, now: () => now });
}

function storedSubscription(id: string) {
  return db.rows('subscriptions').find((row) => row.stripe_subscription_id === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDoubleBillingAlert.mockResolvedValue('sent');
  for (const key of Object.keys(serverEnv)) delete serverEnv[key];
  Object.assign(serverEnv, billingServerEnv());
  db = new InMemoryBillingDb();
  db.seed('accounts', [
    { id: BRAND, business_name: 'New Venue', billing_override: null },
    { id: OTHER_BRAND, business_name: 'Other Venue', billing_override: null },
  ]);
  db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: CUSTOMER }]);
  fake = createFakeStripe();
});

describe('reconcileBrandFromStripe: mapping Stripe onto the subscriptions row', () => {
  it('records a trial on Starter monthly with the fetch time as stripe_state_at', async () => {
    fake.subscriptions.push(
      fakeSubscription({
        id: 'sub_trial',
        customer: CUSTOMER,
        status: 'trialing',
        trialEnd: '2026-10-10T09:00:00Z',
        currentPeriodStart: '2026-09-26T09:00:00Z',
        currentPeriodEnd: '2026-10-10T09:00:00Z',
      }),
    );

    const result = await reconcile();

    expect(result).toMatchObject({ outcome: 'synced', subscriptionId: 'sub_trial', status: 'trialing', state: 'trialing' });
    expect(storedSubscription('sub_trial')).toMatchObject({
      account_id: BRAND,
      stripe_customer_id: CUSTOMER,
      status: 'trialing',
      plan: 'starter',
      billing_interval: 'month',
      stripe_price_id: TEST_PRICES.starterMonthly,
      trial_end: '2026-10-10T09:00:00.000Z',
      current_period_start: '2026-09-26T09:00:00.000Z',
      current_period_end: '2026-10-10T09:00:00.000Z',
      cancel_at_period_end: false,
      canceled_at: null,
      stripe_state_at: FETCHED_AT.toISOString(),
    });
    expect(fake.subscriptionsList).toHaveBeenCalledWith({ customer: CUSTOMER, status: 'all', limit: 100 });
  });

  it('records an active annual Professional plan', async () => {
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_pro', customer: CUSTOMER, status: 'active', priceId: TEST_PRICES.professionalAnnual, currentPeriodEnd: '2027-09-26T09:00:00Z' }),
    );
    const result = await reconcile();
    expect(result.state).toBe('active');
    expect(storedSubscription('sub_pro')).toMatchObject({ plan: 'professional', billing_interval: 'year', status: 'active' });
  });

  it('treats past due as grace for 7 days after the unpaid period starts, then lapsed', async () => {
    // Stripe's real shape: the renewal on 20 September moved the period on to
    // 20 October before the payment failed.
    fake.subscriptions.push(
      fakeSubscription({
        id: 'sub_late',
        customer: CUSTOMER,
        status: 'past_due',
        currentPeriodStart: '2026-09-20T09:00:00Z',
        currentPeriodEnd: '2026-10-20T09:00:00Z',
      }),
    );
    expect((await reconcile()).state).toBe('past_due_grace');
    expect(storedSubscription('sub_late')).toMatchObject({
      status: 'past_due',
      current_period_start: '2026-09-20T09:00:00.000Z',
      current_period_end: '2026-10-20T09:00:00.000Z',
    });
    expect((await reconcile(new Date('2026-09-27T09:00:00.001Z'))).state).toBe('lapsed');
  });

  it('lapses a brand whose unpaid period started 8 days ago, even with most of the month left', async () => {
    fake.subscriptions.push(
      fakeSubscription({
        id: 'sub_late',
        customer: CUSTOMER,
        status: 'past_due',
        currentPeriodStart: '2026-09-18T10:00:00Z',
        currentPeriodEnd: '2026-10-18T10:00:00Z',
      }),
    );
    expect((await reconcile()).state).toBe('lapsed');
  });

  it('records a cancelled subscription as lapsed with its cancel time', async () => {
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_gone', customer: CUSTOMER, status: 'canceled', canceledAt: '2026-09-20T12:00:00Z' }),
    );
    const result = await reconcile();
    expect(result.state).toBe('lapsed');
    expect(storedSubscription('sub_gone')).toMatchObject({ status: 'canceled', canceled_at: '2026-09-20T12:00:00.000Z' });
  });

  it('records an incomplete first payment as incomplete (held)', async () => {
    fake.subscriptions.push(fakeSubscription({ id: 'sub_new', customer: CUSTOMER, status: 'incomplete' }));
    const result = await reconcile();
    expect(result.state).toBe('incomplete');
    expect(storedSubscription('sub_new')?.status).toBe('incomplete');
  });

  it('marks a plan cancelled from the portal (cancel_at) as ending at period end', async () => {
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_ending', customer: CUSTOMER, status: 'active', cancelAt: '2026-10-10T09:00:00Z' }),
    );
    await reconcile();
    expect(storedSubscription('sub_ending')?.cancel_at_period_end).toBe(true);
  });
});

describe('reconcileBrandFromStripe: ordering and safety', () => {
  it('never lets an older state overwrite a newer one', async () => {
    db.seed('subscriptions', [
      {
        stripe_subscription_id: 'sub_x',
        account_id: BRAND,
        stripe_customer_id: CUSTOMER,
        status: 'canceled',
        plan: 'starter',
        billing_interval: 'month',
        stripe_price_id: TEST_PRICES.starterMonthly,
        stripe_state_at: '2026-09-26T10:05:00.000Z',
      },
    ]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_x', customer: CUSTOMER, status: 'active' }));

    // This read started at 10:00, before the stored 10:05 state was read.
    const result = await reconcile();

    expect(result.outcome).toBe('stale');
    expect(storedSubscription('sub_x')).toMatchObject({ status: 'canceled', stripe_state_at: '2026-09-26T10:05:00.000Z' });
  });

  it('replaces an older stored state with a newer one', async () => {
    db.seed('subscriptions', [
      {
        stripe_subscription_id: 'sub_x',
        account_id: BRAND,
        stripe_customer_id: CUSTOMER,
        status: 'trialing',
        plan: 'starter',
        billing_interval: 'month',
        stripe_price_id: TEST_PRICES.starterMonthly,
        stripe_state_at: '2026-09-20T10:00:00.000Z',
      },
    ]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_x', customer: CUSTOMER, status: 'active', priceId: TEST_PRICES.professionalMonthly }));

    const result = await reconcile();

    expect(result.outcome).toBe('synced');
    expect(storedSubscription('sub_x')).toMatchObject({ status: 'active', plan: 'professional', stripe_state_at: FETCHED_AT.toISOString() });
  });

  it('prefers the live subscription over an older cancelled one and keeps the older row truthful', async () => {
    db.seed('subscriptions', [
      {
        stripe_subscription_id: 'sub_old',
        account_id: BRAND,
        stripe_customer_id: CUSTOMER,
        status: 'active',
        plan: 'starter',
        billing_interval: 'month',
        stripe_price_id: TEST_PRICES.starterMonthly,
        stripe_state_at: '2026-08-01T10:00:00.000Z',
      },
    ]);
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_old', customer: CUSTOMER, status: 'canceled', created: '2026-07-01T09:00:00Z' }),
      fakeSubscription({ id: 'sub_new', customer: CUSTOMER, status: 'active', created: '2026-09-25T09:00:00Z' }),
    );

    const result = await reconcile();

    expect(result).toMatchObject({ subscriptionId: 'sub_new', state: 'active' });
    expect(storedSubscription('sub_old')?.status).toBe('canceled');
    expect(Date.parse(String(storedSubscription('sub_old')?.stripe_state_at))).toBeLessThan(
      Date.parse(String(storedSubscription('sub_new')?.stripe_state_at)),
    );
  });

  it('ignores a subscription on the customer that is not a CheersAI one', async () => {
    fake.subscriptions.push(fakeSubscription({ id: 'sub_foreign', customer: CUSTOMER, status: 'active', priceId: 'price_management_app', metadata: {} }));
    const result = await reconcile();
    expect(result.outcome).toBe('no_subscription');
    expect(db.rows('subscriptions')).toHaveLength(0);
  });

  it('does nothing for a brand with no Stripe customer', async () => {
    db.tables.billing_customers = [];
    const result = await reconcile();
    expect(result).toMatchObject({ outcome: 'no_customer', state: 'incomplete' });
    expect(fake.subscriptionsList).not.toHaveBeenCalled();
  });

  it('keeps a subscriber on a replaced (grandfathered) CheersAI price, mapped by the price metadata', async () => {
    fake.subscriptions.push(
      fakeSubscription({
        id: 'sub_grandfathered',
        customer: CUSTOMER,
        status: 'active',
        priceId: 'price_2025_professional_monthly',
        priceMetadata: { app: 'cheersai', plan: 'professional', interval: 'month' },
        priceInterval: 'month',
      }),
    );
    const result = await reconcile();
    expect(result).toMatchObject({ outcome: 'synced', state: 'active' });
    expect(storedSubscription('sub_grandfathered')).toMatchObject({
      plan: 'professional',
      billing_interval: 'month',
      stripe_price_id: 'price_2025_professional_monthly',
    });
  });

  it('maps a new CheersAI price by its lookup key', async () => {
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_new_price', customer: CUSTOMER, status: 'active', priceId: 'price_2027_starter_annual', priceLookupKey: 'cheers_starter_annual' }),
    );
    await reconcile();
    expect(storedSubscription('sub_new_price')).toMatchObject({ plan: 'starter', billing_interval: 'year' });
  });

  it('refuses a CheersAI subscription on a price it does not know, and writes nothing', async () => {
    fake.subscriptions.push(fakeSubscription({ id: 'sub_odd', customer: CUSTOMER, status: 'active', priceId: 'price_unknown' }));
    await expect(reconcile()).rejects.toBeInstanceOf(ReconcileError);
    expect(db.rows('subscriptions')).toHaveLength(0);
  });

  it('refuses a subscription tagged for another brand', async () => {
    fake.subscriptions.push(fakeSubscription({ id: 'sub_theirs', customer: CUSTOMER, status: 'active', metadata: { app: 'cheersai', account_id: OTHER_BRAND } }));
    await expect(reconcile()).rejects.toThrow(/another brand/);
    expect(db.rows('subscriptions')).toHaveLength(0);
  });

  it('fails loudly when Stripe is down', async () => {
    fake.subscriptionsList.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    await expect(reconcile()).rejects.toThrow('Stripe API unavailable');
  });

  it('fails loudly when the database is down', async () => {
    fake.subscriptions.push(fakeSubscription({ id: 'sub_trial', customer: CUSTOMER, status: 'trialing' }));
    db.fail('subscriptions', 'update');
    await expect(reconcile()).rejects.toThrow(/subscriptions update failed/);
  });

  it('refuses to run without the Stripe settings', async () => {
    delete serverEnv.STRIPE_PRICE_PROFESSIONAL_ANNUAL;
    await expect(reconcile()).rejects.toBeInstanceOf(BillingNotConfiguredError);
  });
});

describe('reconcileBrandFromStripe: held posts', () => {
  it('releases future held posts once the brand may publish, leaving overdue ones for review', async () => {
    db.seed('publish_jobs', [
      { id: '1a1a1a1a-1111-4111-8111-111111111111', account_id: BRAND, status: 'held', hold_reason: 'entitlement', next_attempt_at: '2026-09-27T09:00:00Z' },
      { id: '2b2b2b2b-2222-4222-8222-222222222222', account_id: BRAND, status: 'held', hold_reason: 'entitlement', next_attempt_at: '2026-09-25T09:00:00Z' },
      { id: '3c3c3c3c-3333-4333-8333-333333333333', account_id: OTHER_BRAND, status: 'held', hold_reason: 'entitlement', next_attempt_at: '2026-09-27T09:00:00Z' },
    ]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_trial', customer: CUSTOMER, status: 'trialing' }));

    const result = await reconcile();

    expect(result).toMatchObject({ released: 1, stillHeld: 1 });
    const statuses = Object.fromEntries(db.rows('publish_jobs').map((row) => [row.id, row.status]));
    expect(statuses).toEqual({
      '1a1a1a1a-1111-4111-8111-111111111111': 'queued',
      '2b2b2b2b-2222-4222-8222-222222222222': 'held',
      '3c3c3c3c-3333-4333-8333-333333333333': 'held',
    });
  });

  it('releases nothing while the brand is still held', async () => {
    db.seed('publish_jobs', [
      { id: '1a1a1a1a-1111-4111-8111-111111111111', account_id: BRAND, status: 'held', hold_reason: 'entitlement', next_attempt_at: '2026-09-27T09:00:00Z' },
    ]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_gone', customer: CUSTOMER, status: 'canceled' }));
    const result = await reconcile();
    expect(result).toMatchObject({ state: 'lapsed', released: 0 });
    expect(db.rows('publish_jobs')[0].status).toBe('held');
  });
});

function storedRow(values: Record<string, unknown>) {
  return {
    stripe_subscription_id: 'sub_stored',
    account_id: BRAND,
    stripe_customer_id: CUSTOMER,
    status: 'active',
    plan: 'starter',
    billing_interval: 'month',
    stripe_price_id: TEST_PRICES.starterMonthly,
    current_period_start: '2026-09-10T09:00:00.000Z',
    current_period_end: '2026-10-10T09:00:00.000Z',
    stripe_state_at: '2026-09-10T09:00:00.000Z',
    ...values,
  };
}

describe('reconcileBrandFromStripe: stored rows Stripe no longer lists', () => {
  it('marks a stored live row cancelled, with a fresh stripe_state_at, when Stripe lists no CheersAI subscription', async () => {
    db.seed('subscriptions', [storedRow({ stripe_subscription_id: 'sub_deleted_in_stripe' })]);

    const result = await reconcile();

    expect(result).toMatchObject({ outcome: 'no_subscription', state: 'lapsed' });
    expect(storedSubscription('sub_deleted_in_stripe')).toMatchObject({ status: 'canceled', stripe_state_at: FETCHED_AT.toISOString() });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/no longer lists/), expect.objectContaining({ subscriptionIds: ['sub_deleted_in_stripe'] }));
  });

  it('also cancels a stale live row when Stripe lists a different current subscription', async () => {
    db.seed('subscriptions', [storedRow({ stripe_subscription_id: 'sub_vanished' })]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_now', customer: CUSTOMER, status: 'active' }));

    const result = await reconcile();

    expect(result).toMatchObject({ subscriptionId: 'sub_now', state: 'active' });
    expect(storedSubscription('sub_vanished')?.status).toBe('canceled');
    expect(Date.parse(String(storedSubscription('sub_vanished')?.stripe_state_at))).toBeLessThan(
      Date.parse(String(storedSubscription('sub_now')?.stripe_state_at)),
    );
  });

  it('never touches another brand\'s rows or a row with a newer stored state', async () => {
    db.seed('subscriptions', [
      storedRow({ stripe_subscription_id: 'sub_other_brand', account_id: OTHER_BRAND, stripe_customer_id: 'cus_other' }),
      storedRow({ stripe_subscription_id: 'sub_newer', stripe_state_at: '2026-09-26T10:05:00.000Z' }),
    ]);

    await reconcile();

    expect(storedSubscription('sub_other_brand')).toMatchObject({ status: 'active', stripe_state_at: '2026-09-10T09:00:00.000Z' });
    expect(storedSubscription('sub_newer')?.status).toBe('active');
  });

  it('refuses to work from a truncated Stripe list (more than 100 subscriptions)', async () => {
    db.seed('subscriptions', [storedRow({})]);
    fake.subscriptionsList.mockResolvedValueOnce({ object: 'list', data: [], has_more: true });
    await expect(reconcile()).rejects.toBeInstanceOf(ReconcileError);
    expect(storedSubscription('sub_stored')?.status).toBe('active');
  });
});

describe('reconcileBrandFromStripe: possible double billing', () => {
  it('alerts the operator when the customer has more than one live CheersAI subscription', async () => {
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_a', customer: CUSTOMER, status: 'active', created: '2026-09-01T09:00:00Z' }),
      fakeSubscription({ id: 'sub_b', customer: CUSTOMER, status: 'trialing', created: '2026-09-20T09:00:00Z' }),
      fakeSubscription({ id: 'sub_old', customer: CUSTOMER, status: 'canceled', created: '2026-07-01T09:00:00Z' }),
    );

    const result = await reconcile();

    expect(result.outcome).toBe('synced');
    expect(mockDoubleBillingAlert).toHaveBeenCalledWith(expect.anything(), {
      accountId: BRAND,
      customerId: CUSTOMER,
      subscriptionIds: ['sub_a', 'sub_b'],
    });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/double billing/), undefined, expect.objectContaining({ accountId: BRAND }));
  });

  it('does not alert for one live subscription plus ended ones', async () => {
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_a', customer: CUSTOMER, status: 'active' }),
      fakeSubscription({ id: 'sub_old', customer: CUSTOMER, status: 'canceled' }),
    );
    await reconcile();
    expect(mockDoubleBillingAlert).not.toHaveBeenCalled();
  });

  it('still reconciles when the alert cannot be sent, and logs that', async () => {
    mockDoubleBillingAlert.mockRejectedValueOnce(new Error('Resend down'));
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_a', customer: CUSTOMER, status: 'active' }),
      fakeSubscription({ id: 'sub_b', customer: CUSTOMER, status: 'past_due' }),
    );
    expect((await reconcile()).outcome).toBe('synced');
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/could not be sent/), expect.any(Error), expect.anything());
  });
});

describe('hasLiveCheersSubscription', () => {
  const check = () => hasLiveCheersSubscription(db.client(), BRAND, { stripe: fake.stripe });

  it('is true for a stored live row of this brand', async () => {
    db.seed('subscriptions', [storedRow({ status: 'past_due' })]);
    expect(await check()).toBe(true);
    expect(fake.subscriptionsList).not.toHaveBeenCalled();
  });

  it('is true when Stripe lists a live CheersAI subscription the database has not seen yet', async () => {
    fake.subscriptions.push(fakeSubscription({ customer: CUSTOMER, status: 'trialing' }));
    expect(await check()).toBe(true);
  });

  it('is false for ended subscriptions, and ignores another brand\'s live rows', async () => {
    db.seed('subscriptions', [
      storedRow({ status: 'canceled' }),
      storedRow({ stripe_subscription_id: 'sub_other', account_id: OTHER_BRAND, stripe_customer_id: 'cus_other', status: 'active' }),
    ]);
    fake.subscriptions.push(fakeSubscription({ customer: CUSTOMER, status: 'canceled' }), fakeSubscription({ customer: 'cus_other', status: 'active' }));
    expect(await check()).toBe(false);
  });

  it('uses the stored rows only when Stripe is not configured', async () => {
    delete serverEnv.STRIPE_SECRET_KEY;
    fake.subscriptions.push(fakeSubscription({ customer: CUSTOMER, status: 'active' }));
    expect(await check()).toBe(false);
    expect(fake.subscriptionsList).not.toHaveBeenCalled();
  });

  it('throws when a lookup fails, so callers fail closed', async () => {
    db.fail('subscriptions', 'select');
    await expect(check()).rejects.toThrow(/subscriptions lookup failed/);
    db = new InMemoryBillingDb();
    db.seed('accounts', [{ id: BRAND, business_name: 'New Venue' }]);
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: CUSTOMER }]);
    fake.subscriptionsList.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    await expect(check()).rejects.toThrow('Stripe API unavailable');
  });
});

describe('reconcileBrandFromStripe: brand scoping', () => {
  beforeEach(() => {
    // The other brand has its own customer and a newer, live stored subscription.
    db.seed('billing_customers', [{ account_id: OTHER_BRAND, stripe_customer_id: 'cus_other_brand' }]);
    db.seed('subscriptions', [
      storedRow({
        stripe_subscription_id: 'sub_other_brand',
        account_id: OTHER_BRAND,
        stripe_customer_id: 'cus_other_brand',
        status: 'active',
        stripe_state_at: '2026-09-26T11:00:00.000Z',
      }),
    ]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_other_brand', customer: 'cus_other_brand', status: 'active' }));
  });

  it('lists only this brand\'s customer and decides the state from this brand\'s rows alone', async () => {
    fake.subscriptions.push(fakeSubscription({ id: 'sub_mine', customer: CUSTOMER, status: 'canceled' }));

    const result = await reconcile();

    expect(fake.subscriptionsList).toHaveBeenCalledTimes(1);
    expect(fake.subscriptionsList).toHaveBeenCalledWith(expect.objectContaining({ customer: CUSTOMER }));
    expect(result).toMatchObject({ subscriptionId: 'sub_mine', state: 'lapsed' });
    expect(storedSubscription('sub_other_brand')).toMatchObject({ account_id: OTHER_BRAND, status: 'active', stripe_state_at: '2026-09-26T11:00:00.000Z' });
  });

  it('scopes every subscriptions and billing_customers query to this brand', async () => {
    db.seed('subscriptions', [storedRow({ stripe_subscription_id: 'sub_vanished' })]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_mine', customer: CUSTOMER, status: 'active' }));

    await reconcile();
    await hasLiveCheersSubscription(db.client(), BRAND, { stripe: fake.stripe });

    const billingQueries = db.queries.filter((query) => query.table === 'subscriptions' || query.table === 'billing_customers');
    expect(billingQueries.length).toBeGreaterThan(5);
    for (const query of billingQueries) {
      // The one deliberate exception: the ownership check that refuses a
      // subscription id already stored against another brand.
      const ownershipCheck = query.op === 'select' && query.columns === 'account_id' && query.eq.length === 1 && query.eq[0][0] === 'stripe_subscription_id';
      if (ownershipCheck) continue;
      if (query.op === 'insert') continue;
      expect(query.eq, `${query.op} ${query.table} ${query.columns ?? ''}`).toContainEqual(['account_id', BRAND]);
    }
    expect(storedSubscription('sub_vanished')?.status).toBe('canceled');
  });

  it('never takes over a subscription stored against another brand', async () => {
    // An older stored state, so only the brand filter stops this read overwriting it.
    Object.assign(db.tables.subscriptions.find((row) => row.stripe_subscription_id === 'sub_other_brand') ?? {}, {
      stripe_state_at: '2026-09-01T00:00:00.000Z',
    });
    // Stripe lists the other brand's subscription id on this brand's customer.
    fake.subscriptions.push(fakeSubscription({ id: 'sub_other_brand', customer: CUSTOMER, status: 'active', metadata: { app: 'cheersai' } }));
    fake.subscriptions = fake.subscriptions.filter((subscription) => subscription.customer === CUSTOMER);

    await expect(reconcile()).rejects.toThrow(/stored against another brand/);
    expect(storedSubscription('sub_other_brand')).toMatchObject({ account_id: OTHER_BRAND, stripe_customer_id: 'cus_other_brand' });
  });
});
