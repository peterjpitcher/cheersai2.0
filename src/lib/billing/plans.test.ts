import { beforeEach, describe, expect, it, vi } from 'vitest';

import { billingServerEnv, TEST_PRICES } from '../../../tests/helpers/fake-stripe';

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: {} } }));

const { planForStripePrice } = await import('./plans');

beforeEach(() => {
  for (const key of Object.keys(serverEnv)) delete serverEnv[key];
  Object.assign(serverEnv, billingServerEnv());
});

describe('planForStripePrice', () => {
  it('maps the configured env price ids first', () => {
    expect(planForStripePrice(TEST_PRICES.starterMonthly)).toEqual({ plan: 'starter', interval: 'month' });
    expect(planForStripePrice({ id: TEST_PRICES.professionalAnnual })).toEqual({ plan: 'professional', interval: 'year' });
  });

  it('maps a replaced or grandfathered CheersAI price by its metadata', () => {
    const old = { id: 'price_old_professional', metadata: { app: 'cheersai', plan: 'professional', interval: 'month' }, lookup_key: null };
    expect(planForStripePrice(old)).toEqual({ plan: 'professional', interval: 'month' });
    expect(planForStripePrice({ id: 'price_old_annual', metadata: { app: 'cheersai', plan: 'starter', interval: 'annual' } })).toEqual({
      plan: 'starter',
      interval: 'year',
    });
  });

  it('maps a CheersAI price by its lookup key (cheers_<plan>_<monthly|annual>)', () => {
    expect(planForStripePrice({ id: 'price_new', metadata: {}, lookup_key: 'cheers_professional_annual' })).toEqual({
      plan: 'professional',
      interval: 'year',
    });
    expect(planForStripePrice({ id: 'price_new', lookup_key: 'cheers_starter_monthly' })).toEqual({ plan: 'starter', interval: 'month' });
  });

  it('prefers the env mapping over a price label', () => {
    const mislabelled = { id: TEST_PRICES.starterMonthly, metadata: { app: 'cheersai', plan: 'professional', interval: 'year' } };
    expect(planForStripePrice(mislabelled)).toEqual({ plan: 'starter', interval: 'month' });
  });

  it('ignores prices that are not CheersAI ones, or whose label disagrees with how Stripe bills them', () => {
    expect(planForStripePrice({ id: 'price_management_app', metadata: { plan: 'starter', interval: 'month' } })).toBeNull();
    expect(planForStripePrice({ id: 'price_x', metadata: { app: 'cheersai', plan: 'group', interval: 'month' } })).toBeNull();
    expect(planForStripePrice({ id: 'price_x', lookup_key: 'cheers_group_monthly' })).toBeNull();
    expect(planForStripePrice({ id: 'price_x', lookup_key: 'management_starter_monthly' })).toBeNull();
    expect(
      planForStripePrice({ id: 'price_x', metadata: { app: 'cheersai', plan: 'starter', interval: 'month' }, recurring: { interval: 'year' } }),
    ).toBeNull();
    expect(planForStripePrice('')).toBeNull();
  });
});

describe('effectivePlanForLimits', () => {
  it('uses the trial plan (Starter) for any plan while trialing, and the chosen plan otherwise', async () => {
    const { effectivePlanForLimits, TRIAL_PLAN } = await import('./plans');
    expect(TRIAL_PLAN).toBe('starter');
    expect(effectivePlanForLimits('trialing', 'professional')).toBe('starter');
    expect(effectivePlanForLimits('trialing', 'starter')).toBe('starter');
    expect(effectivePlanForLimits('active', 'professional')).toBe('professional');
    expect(effectivePlanForLimits('past_due', 'professional')).toBe('professional');
  });
});
