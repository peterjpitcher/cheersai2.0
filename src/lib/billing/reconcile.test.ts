import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBillingDb } from '../../../tests/helpers/in-memory-billing-db';
import { billingServerEnv, createFakeStripe, fakeSubscription, TEST_PRICES, type FakeStripe } from '../../../tests/helpers/fake-stripe';

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } } }));
vi.mock('@/lib/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { reconcileBrandFromStripe, ReconcileError } = await import('./reconcile');
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
