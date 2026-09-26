import type Stripe from 'stripe';
import { vi } from 'vitest';

/**
 * Stripe TEST mode objects set up for CheersAI on 2026-09-26 (Orange Jelly
 * Limited, acct_1HUtLSIMsxxxvzCC). Ids only, no secrets.
 */
export const TEST_PRICES = {
  starterMonthly: 'price_1UJs0CIMsxxxvzCCbeBtgOie',
  starterAnnual: 'price_1UJs0DIMsxxxvzCCHBoaWxfh',
  professionalMonthly: 'price_1UJs0DIMsxxxvzCCTpXkzq5a',
  professionalAnnual: 'price_1UJs0EIMsxxxvzCCcjrOKfZZ',
} as const;
export const TEST_PORTAL_CONFIGURATION = 'bpc_1UJs0QIMsxxxvzCCRkUnIFH8';

/** A server env with billing fully configured (test mode), for mocking '@/env'. */
export function billingServerEnv(): Record<string, string> {
  return {
    STRIPE_SECRET_KEY: 'sk_test_unit',
    STRIPE_WEBHOOK_SECRET: 'whsec_unit_test_secret',
    STRIPE_PRICE_STARTER_MONTHLY: TEST_PRICES.starterMonthly,
    STRIPE_PRICE_STARTER_ANNUAL: TEST_PRICES.starterAnnual,
    STRIPE_PRICE_PROFESSIONAL_MONTHLY: TEST_PRICES.professionalMonthly,
    STRIPE_PRICE_PROFESSIONAL_ANNUAL: TEST_PRICES.professionalAnnual,
    STRIPE_PORTAL_CONFIGURATION_ID: TEST_PORTAL_CONFIGURATION,
    OPERATOR_ALERT_EMAIL: 'operator@example.test',
  };
}

const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export interface FakeSubscriptionInput {
  id?: string;
  customer: string;
  status: string;
  priceId?: string;
  created?: string;
  trialEnd?: string | null;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: string | null;
  canceledAt?: string | null;
  metadata?: Record<string, string>;
}

let counter = 0;

/** A Stripe subscription object with the fields reconcile reads (API 2026-08-26.dahlia shape). */
export function fakeSubscription(input: FakeSubscriptionInput): Stripe.Subscription {
  counter += 1;
  const id = input.id ?? `sub_test_${counter}`;
  return {
    id,
    object: 'subscription',
    customer: input.customer,
    status: input.status,
    created: seconds(input.created ?? '2026-09-26T09:00:00Z'),
    trial_end: input.trialEnd ? seconds(input.trialEnd) : null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    cancel_at: input.cancelAt ? seconds(input.cancelAt) : null,
    canceled_at: input.canceledAt ? seconds(input.canceledAt) : null,
    metadata: input.metadata ?? { app: 'cheersai' },
    items: {
      object: 'list',
      data: [
        {
          id: `si_${id}`,
          object: 'subscription_item',
          price: { id: input.priceId ?? TEST_PRICES.starterMonthly, object: 'price' },
          current_period_end: seconds(input.currentPeriodEnd ?? '2026-10-10T09:00:00Z'),
        },
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`,
    },
  } as unknown as Stripe.Subscription;
}

export interface FakeStripe {
  stripe: Stripe;
  subscriptions: Stripe.Subscription[];
  openSessions: Array<{ id: string; metadata: Record<string, string> }>;
  customersCreate: ReturnType<typeof vi.fn>;
  subscriptionsList: ReturnType<typeof vi.fn>;
  sessionsCreate: ReturnType<typeof vi.fn>;
  sessionsList: ReturnType<typeof vi.fn>;
  sessionsExpire: ReturnType<typeof vi.fn>;
  portalCreate: ReturnType<typeof vi.fn>;
}

/** A Stripe client double. Every call is a vi.fn so tests can assert on params or make it fail. */
export function createFakeStripe(): FakeStripe {
  const fake = {
    subscriptions: [] as Stripe.Subscription[],
    openSessions: [] as Array<{ id: string; metadata: Record<string, string> }>,
  } as FakeStripe;

  fake.customersCreate = vi.fn(async (params: { metadata?: Record<string, string> }) => ({
    id: 'cus_test_new',
    object: 'customer',
    metadata: params.metadata ?? {},
  }));
  fake.subscriptionsList = vi.fn(async (params: { customer: string }) => ({
    object: 'list',
    data: fake.subscriptions.filter((subscription) => subscription.customer === params.customer),
    has_more: false,
  }));
  let sessionCount = 0;
  fake.sessionsCreate = vi.fn(async () => {
    sessionCount += 1;
    return { id: `cs_test_${sessionCount}`, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/cs_test_${sessionCount}` };
  });
  fake.sessionsList = vi.fn(async () => ({ object: 'list', data: fake.openSessions, has_more: false }));
  fake.sessionsExpire = vi.fn(async (id: string) => ({ id, status: 'expired' }));
  fake.portalCreate = vi.fn(async () => ({ id: 'bps_test_1', url: 'https://billing.stripe.com/p/session/test_1' }));

  fake.stripe = {
    customers: { create: fake.customersCreate },
    subscriptions: { list: fake.subscriptionsList },
    checkout: { sessions: { create: fake.sessionsCreate, list: fake.sessionsList, expire: fake.sessionsExpire } },
    billingPortal: { sessions: { create: fake.portalCreate } },
  } as unknown as Stripe;
  return fake;
}
