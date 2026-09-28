import { beforeEach, describe, expect, it, vi } from 'vitest';

import { billingServerEnv } from '../../../tests/helpers/fake-stripe';

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: {} } }));

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ createLogger: () => logger }));

const { BillingNotConfiguredError, getStripe, missingBillingEnv } = await import('./stripe');

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(serverEnv)) delete serverEnv[key];
  Object.assign(serverEnv, billingServerEnv());
});

describe('Stripe key mode', () => {
  it('treats a test-mode key in production as billing not set up, and logs it', () => {
    serverEnv.VERCEL_ENV = 'production';
    serverEnv.STRIPE_SECRET_KEY = 'sk_test_in_production_1';

    expect(missingBillingEnv('checkout')).toEqual(['STRIPE_SECRET_KEY']);
    expect(missingBillingEnv('webhook')).toEqual(['STRIPE_SECRET_KEY']);
    expect(() => getStripe()).toThrow(BillingNotConfiguredError);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk_test_in_production_1');
  });

  it('refuses a restricted test key in production too', () => {
    serverEnv.VERCEL_ENV = 'production';
    serverEnv.STRIPE_SECRET_KEY = 'rk_test_in_production_2';
    expect(missingBillingEnv('portal')).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('accepts live secret and restricted keys in production', () => {
    serverEnv.VERCEL_ENV = 'production';
    for (const key of ['sk_live_unit', 'rk_live_unit']) {
      serverEnv.STRIPE_SECRET_KEY = key;
      expect(missingBillingEnv('checkout')).toEqual([]);
      expect(() => getStripe()).not.toThrow();
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('needs TRIAL_CARD_HASH_KEY for Checkout, reconcile and the webhook, not for the portal or a lookup (spec §4.7)', () => {
    delete serverEnv.TRIAL_CARD_HASH_KEY;
    expect(missingBillingEnv('checkout')).toEqual(['TRIAL_CARD_HASH_KEY']);
    expect(missingBillingEnv('reconcile')).toEqual(['TRIAL_CARD_HASH_KEY']);
    expect(missingBillingEnv('webhook')).toEqual(['TRIAL_CARD_HASH_KEY']);
    expect(missingBillingEnv('portal')).toEqual([]);
    expect(missingBillingEnv('lookup')).toEqual([]);
  });

  it('treats a TRIAL_CARD_HASH_KEY that is not 64 hex characters as missing, and logs it without the key', () => {
    for (const bad of ['abc123', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      serverEnv.TRIAL_CARD_HASH_KEY = bad;
      expect(missingBillingEnv('webhook')).toEqual(['TRIAL_CARD_HASH_KEY']);
    }
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('abc123');
    serverEnv.TRIAL_CARD_HASH_KEY = 'A'.repeat(32) + '0'.repeat(32);
    expect(missingBillingEnv('webhook')).toEqual([]);
  });

  it('accepts a test key outside production (preview, development, local)', () => {
    for (const vercelEnv of ['preview', 'development', '']) {
      serverEnv.VERCEL_ENV = vercelEnv;
      serverEnv.STRIPE_SECRET_KEY = 'sk_test_unit';
      expect(missingBillingEnv('checkout')).toEqual([]);
    }
  });
});
