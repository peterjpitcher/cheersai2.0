import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBillingDb } from '../../../tests/helpers/in-memory-billing-db';
import { billingServerEnv, TEST_PRICES } from '../../../tests/helpers/fake-stripe';

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: {} } }));

const { billingPlanOptions, getBillingOverview } = await import('./overview');

const BRAND = '6f1d2c3b-4a59-4e68-8d7c-9b0a1f2e3d4c';
const OTHER_BRAND = '7a2e3d4c-5b6a-4f79-9e8d-0c1b2a3f4e5d';
let db: InMemoryBillingDb;

function subscription(values: Record<string, unknown>) {
  return {
    stripe_subscription_id: 'sub_1',
    account_id: BRAND,
    stripe_customer_id: 'cus_1',
    status: 'active',
    plan: 'starter',
    billing_interval: 'month',
    stripe_price_id: TEST_PRICES.starterMonthly,
    stripe_state_at: '2026-09-26T10:00:00Z',
    ...values,
  };
}

beforeEach(() => {
  for (const key of Object.keys(serverEnv)) delete serverEnv[key];
  Object.assign(serverEnv, billingServerEnv());
  db = new InMemoryBillingDb();
  db.seed('accounts', [{ id: BRAND, business_name: 'New Venue', billing_override: null }]);
});

describe('getBillingOverview', () => {
  it('shows a new brand as not set up, with the trial on offer', async () => {
    const overview = await getBillingOverview(db.client(), BRAND);
    expect(overview).toEqual({
      state: 'incomplete',
      subscription: null,
      hasCustomer: false,
      liveSubscription: false,
      trial: 'eligible',
      checkoutReady: true,
      portalReady: true,
      trialLimitsPlan: { plan: 'starter', name: 'Starter' },
    });
  });

  it('words the trial as uncertain when a Stripe customer exists but no subscription is recorded', async () => {
    // For example an abandoned Checkout, or an earlier subscription never synced:
    // the server gives no trial if Stripe lists any earlier CheersAI subscription.
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_1' }]);
    expect((await getBillingOverview(db.client(), BRAND)).trial).toBe('uncertain');
  });

  it('shows a comped brand as comped whatever Stripe says', async () => {
    db.tables.accounts[0].billing_override = 'comped';
    expect((await getBillingOverview(db.client(), BRAND)).state).toBe('comped');
  });

  it('flags a comped brand that still has a live stored subscription, so its owners keep the portal', async () => {
    db.tables.accounts[0].billing_override = 'comped';
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_1' }]);
    db.seed('subscriptions', [subscription({ status: 'active' })]);
    expect(await getBillingOverview(db.client(), BRAND)).toMatchObject({ state: 'comped', hasCustomer: true, liveSubscription: true });
  });

  it('does not flag ended subscriptions as live, even behind a newer row', async () => {
    db.seed('subscriptions', [
      subscription({ stripe_subscription_id: 'sub_old', status: 'canceled', stripe_state_at: '2026-09-01T10:00:00Z' }),
      subscription({ stripe_subscription_id: 'sub_new', status: 'incomplete_expired' }),
    ]);
    expect((await getBillingOverview(db.client(), BRAND)).liveSubscription).toBe(false);
  });

  it('labels a trial end on the London calendar (a late UTC time in summer is the next day)', async () => {
    db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: 'cus_1' }]);
    db.seed('subscriptions', [subscription({ status: 'trialing', trial_end: '2026-10-09T23:30:00Z', current_period_end: '2026-10-09T23:30:00Z' })]);
    const overview = await getBillingOverview(db.client(), BRAND, new Date('2026-09-26T10:00:00Z'));
    expect(overview.state).toBe('trialing');
    expect(overview.hasCustomer).toBe(true);
    expect(overview.trial).toBe('ineligible');
    expect(overview.subscription).toMatchObject({ planName: 'Starter', interval: 'month', trialEndLabel: '10 October 2026' });
  });

  it('gives a past-due brand the date its 7-day grace ends, counted from the start of the unpaid period', async () => {
    // Stripe's real shape: the unpaid period started 1 November and runs to 1 December.
    db.seed('subscriptions', [
      subscription({ status: 'past_due', current_period_start: '2026-11-01T12:00:00Z', current_period_end: '2026-12-01T12:00:00Z' }),
    ]);
    const overview = await getBillingOverview(db.client(), BRAND, new Date('2026-11-03T12:00:00Z'));
    expect(overview.state).toBe('past_due_grace');
    expect(overview.subscription?.graceEndLabel).toBe('8 November 2026');
  });

  it('shows a brand unpaid for 8 days as lapsed', async () => {
    db.seed('subscriptions', [
      subscription({ status: 'past_due', current_period_start: '2026-11-01T12:00:00Z', current_period_end: '2026-12-01T12:00:00Z' }),
    ]);
    expect((await getBillingOverview(db.client(), BRAND, new Date('2026-11-09T12:00:00Z'))).state).toBe('lapsed');
  });

  it('falls back to the period end for a legacy row with no period start', async () => {
    db.seed('subscriptions', [subscription({ status: 'past_due', current_period_start: null, current_period_end: '2026-11-01T12:00:00Z' })]);
    const overview = await getBillingOverview(db.client(), BRAND, new Date('2026-11-03T12:00:00Z'));
    expect(overview.subscription?.graceEndLabel).toBe('8 November 2026');
  });

  it('uses the newest stored state', async () => {
    db.seed('subscriptions', [
      subscription({ stripe_subscription_id: 'sub_old', status: 'canceled', stripe_state_at: '2026-09-01T10:00:00Z' }),
      subscription({ stripe_subscription_id: 'sub_new', status: 'active', plan: 'professional', stripe_price_id: TEST_PRICES.professionalMonthly }),
    ]);
    const overview = await getBillingOverview(db.client(), BRAND, new Date('2026-09-26T12:00:00Z'));
    expect(overview).toMatchObject({ state: 'active', subscription: { planName: 'Professional' } });
  });

  it('reports missing Stripe settings so the page can say billing is not set up', async () => {
    delete serverEnv.STRIPE_PORTAL_CONFIGURATION_ID;
    delete serverEnv.STRIPE_PRICE_STARTER_MONTHLY;
    expect(await getBillingOverview(db.client(), BRAND)).toMatchObject({ checkoutReady: false, portalReady: false });
  });

  it('throws on a database failure (the page shows an error, not a wrong state)', async () => {
    db.fail('subscriptions', 'select');
    await expect(getBillingOverview(db.client(), BRAND)).rejects.toThrow(/subscriptions lookup failed/);
  });
});

describe('billingPlanOptions', () => {
  it('lists Starter and Professional with ex-VAT prices from the plan config', () => {
    expect(billingPlanOptions()).toEqual([
      expect.objectContaining({ plan: 'starter', name: 'Starter', monthlyLabel: '£29.99 + VAT a month', annualLabel: '£323.89 + VAT a year' }),
      expect.objectContaining({ plan: 'professional', name: 'Professional', monthlyLabel: '£59.99 + VAT a month', annualLabel: '£647.89 + VAT a year' }),
    ]);
  });
});

describe('getBillingOverview: brand scoping', () => {
  it('reads only the active brand\'s customer and subscriptions, even when another brand\'s are newer', async () => {
    db.seed('accounts', [{ id: OTHER_BRAND, business_name: 'Someone Else', billing_override: null }]);
    db.seed('billing_customers', [{ account_id: OTHER_BRAND, stripe_customer_id: 'cus_other_brand' }]);
    db.seed('subscriptions', [
      subscription({
        stripe_subscription_id: 'sub_other_brand',
        account_id: OTHER_BRAND,
        stripe_customer_id: 'cus_other_brand',
        status: 'active',
        plan: 'professional',
        stripe_price_id: TEST_PRICES.professionalMonthly,
        stripe_state_at: '2026-09-26T11:00:00Z',
      }),
    ]);

    const overview = await getBillingOverview(db.client(), BRAND, new Date('2026-09-26T12:00:00Z'));

    expect(overview).toMatchObject({ state: 'incomplete', subscription: null, hasCustomer: false, liveSubscription: false, trial: 'eligible' });
  });

  it('uses this brand\'s own state when both brands have subscriptions', async () => {
    db.seed('accounts', [{ id: OTHER_BRAND, business_name: 'Someone Else', billing_override: null }]);
    db.seed('billing_customers', [
      { account_id: BRAND, stripe_customer_id: 'cus_1' },
      { account_id: OTHER_BRAND, stripe_customer_id: 'cus_other_brand' },
    ]);
    db.seed('subscriptions', [
      subscription({ status: 'canceled', stripe_state_at: '2026-09-20T10:00:00Z' }),
      subscription({
        stripe_subscription_id: 'sub_other_brand',
        account_id: OTHER_BRAND,
        stripe_customer_id: 'cus_other_brand',
        status: 'active',
        stripe_state_at: '2026-09-26T11:00:00Z',
      }),
    ]);

    const overview = await getBillingOverview(db.client(), BRAND, new Date('2026-09-26T12:00:00Z'));

    expect(overview).toMatchObject({ state: 'lapsed', hasCustomer: true, liveSubscription: false, subscription: { status: 'canceled' } });
  });
});
