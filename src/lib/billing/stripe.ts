import 'server-only';

import Stripe from 'stripe';

import { env } from '@/env';
import { ALL_STRIPE_PRICE_ENV_KEYS } from '@/lib/billing/plans';
import { createLogger } from '@/lib/logging';

/**
 * The one Stripe client for CheersAI (spec §4.3). Server-only.
 *
 * The Stripe account (Orange Jelly Limited) is shared with the Orange Jelly
 * management app, so everything CheersAI creates carries metadata
 * app=cheersai, and anything that is not about a CheersAI customer is ignored.
 */

/**
 * Pinned explicitly so a library upgrade never changes the API shape under us.
 * This is the version stripe@22.6.2 is typed against; change both together.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;

/** Metadata tag on every CheersAI customer, Checkout Session and subscription. */
export const CHEERSAI_APP_TAG = 'cheersai';

export const BILLING_NOT_CONFIGURED_MESSAGE = 'Billing is not set up yet. Please contact Cheers support.';

type ServerEnvKey = keyof typeof env.server;

export type BillingPurpose = 'checkout' | 'portal' | 'reconcile' | 'webhook';

const REQUIRED_ENV: Record<BillingPurpose, readonly ServerEnvKey[]> = {
  checkout: ['STRIPE_SECRET_KEY', ...ALL_STRIPE_PRICE_ENV_KEYS],
  portal: ['STRIPE_SECRET_KEY', 'STRIPE_PORTAL_CONFIGURATION_ID'],
  // Reconcile maps Stripe prices back to plans, so it needs the price ids too.
  reconcile: ['STRIPE_SECRET_KEY', ...ALL_STRIPE_PRICE_ENV_KEYS],
  webhook: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', ...ALL_STRIPE_PRICE_ENV_KEYS],
};

const logger = createLogger('billing');

/** Secret and restricted keys of Stripe live mode. */
const LIVE_KEY_PREFIXES = ['sk_live_', 'rk_live_'] as const;

let reportedTestKeyInProduction: string | null = null;

/**
 * The Stripe secret key billing may use, or null. In production
 * (VERCEL_ENV=production) only a live-mode key counts: a test-mode key there
 * would write test customers and subscriptions into the production database,
 * so it is treated as "billing not set up" and logged as an error (once per
 * key value, without any of the key itself).
 */
function usableSecretKey(): string | null {
  const key = env.server.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (env.server.VERCEL_ENV === 'production' && !LIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    if (reportedTestKeyInProduction !== key) {
      reportedTestKeyInProduction = key;
      logger.error(
        'STRIPE_SECRET_KEY is not a live-mode key in production; billing is treated as not set up',
        new Error('stripe_key_not_live'),
        { vercelEnv: env.server.VERCEL_ENV },
      );
    }
    return null;
  }
  return key;
}

/** Names of the env vars a billing path needs but does not have (empty when ready). */
export function missingBillingEnv(purpose: BillingPurpose): string[] {
  return REQUIRED_ENV[purpose].filter((key) => (key === 'STRIPE_SECRET_KEY' ? !usableSecretKey() : !env.server[key]));
}

export class BillingNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Stripe billing is not configured (missing: ${missing.join(', ')})`);
    this.name = 'BillingNotConfiguredError';
  }
}

/** Throws BillingNotConfiguredError when a billing path's env vars are missing. */
export function assertBillingConfigured(purpose: BillingPurpose): void {
  const missing = missingBillingEnv(purpose);
  if (missing.length) throw new BillingNotConfiguredError(missing);
}

let cached: { key: string; client: Stripe } | null = null;

/** The shared Stripe client. Throws BillingNotConfiguredError without a usable secret key. */
export function getStripe(): Stripe {
  const key = usableSecretKey();
  if (!key) throw new BillingNotConfiguredError(['STRIPE_SECRET_KEY']);
  if (cached?.key === key) return cached.client;
  const client = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    typescript: true,
    appInfo: { name: 'CheersAI' },
  });
  cached = { key, client };
  return client;
}

/**
 * Verify a webhook delivery and parse it. Needs the raw request body exactly as
 * received. Throws Stripe's signature error for a bad or missing signature.
 */
export function constructStripeEvent(rawBody: string, signature: string, webhookSecret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/** Stripe customer id from an expandable field. */
export function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}
