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
    // A made-up 64 hex character key for the repeat-trial card check (unit tests only).
    TRIAL_CARD_HASH_KEY: '0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0',
  };
}

const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export interface FakeSubscriptionInput {
  id?: string;
  customer: string;
  status: string;
  priceId?: string;
  /** Price metadata and lookup key, as the CheersAI test-mode prices carry them. */
  priceMetadata?: Record<string, string>;
  priceLookupKey?: string | null;
  priceInterval?: 'month' | 'year';
  created?: string;
  trialEnd?: string | null;
  /**
   * When the trial began. Defaults to the creation time for a trialing
   * subscription or one with a trial end (a trial it started with, as Checkout
   * gives), else null. A later time is a trial added to a running subscription.
   */
  trialStart?: string | null;
  /** Defaults to the creation time. */
  startDate?: string;
  /** Start of the current period. For past_due, Stripe has already moved it to the start of the unpaid period. */
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: string | null;
  canceledAt?: string | null;
  metadata?: Record<string, string>;
  /**
   * The default payment method, as Stripe returns it with
   * expand: ['default_payment_method']. Defaults to a card whose fingerprint
   * is unique to the subscription; pass { fingerprint } to share a card
   * between subscriptions, { type: 'link' } for a method with no card, or null
   * for none.
   */
  paymentMethod?: { fingerprint: string | null } | { type: 'link' } | null;
}

let counter = 0;

function fakePaymentMethod(id: string, input: FakeSubscriptionInput['paymentMethod']): Stripe.PaymentMethod | null {
  if (input === null) return null;
  if (input && 'type' in input) {
    return { id: `pm_link_${id}`, object: 'payment_method', type: 'link', link: { email: null } } as unknown as Stripe.PaymentMethod;
  }
  const fingerprint = input ? input.fingerprint : `fp_${id}`;
  return {
    id: `pm_card_${id}`,
    object: 'payment_method',
    type: 'card',
    card: { brand: 'visa', last4: '4242', fingerprint },
  } as unknown as Stripe.PaymentMethod;
}

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
    start_date: seconds(input.startDate ?? input.created ?? '2026-09-26T09:00:00Z'),
    trial_start:
      input.trialStart !== undefined
        ? input.trialStart
          ? seconds(input.trialStart)
          : null
        : input.status === 'trialing' || input.trialEnd
          ? seconds(input.created ?? '2026-09-26T09:00:00Z')
          : null,
    trial_end: input.trialEnd ? seconds(input.trialEnd) : null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    cancel_at: input.cancelAt ? seconds(input.cancelAt) : null,
    canceled_at: input.canceledAt ? seconds(input.canceledAt) : null,
    metadata: input.metadata ?? { app: 'cheersai' },
    default_payment_method: fakePaymentMethod(id, input.paymentMethod),
    items: {
      object: 'list',
      data: [
        {
          id: `si_${id}`,
          object: 'subscription_item',
          price: {
            id: input.priceId ?? TEST_PRICES.starterMonthly,
            object: 'price',
            metadata: input.priceMetadata ?? {},
            lookup_key: input.priceLookupKey ?? null,
            recurring: input.priceInterval ? { interval: input.priceInterval } : null,
          },
          current_period_start: seconds(input.currentPeriodStart ?? '2026-09-26T09:00:00Z'),
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
  /** retrieve(id, params): the stored subscription (its payment method is always expanded). */
  subscriptionsRetrieve: ReturnType<typeof vi.fn>;
  /** cancel(id, params): cancels at once; cancelling a cancelled one fails as Stripe does. */
  subscriptionsCancel: ReturnType<typeof vi.fn>;
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
    data: fake.subscriptions.filter((subscription) => subscription.customer === params.customer).map((subscription) => ({ ...subscription })),
    has_more: false,
  }));
  const find = (id: string): Stripe.Subscription => {
    const subscription = fake.subscriptions.find((candidate) => candidate.id === id);
    if (!subscription) throw Object.assign(new Error(`No such subscription: '${id}'`), { type: 'StripeInvalidRequestError', code: 'resource_missing' });
    return subscription;
  };
  fake.subscriptionsRetrieve = vi.fn(async (id: string) => ({ ...find(id) }));
  fake.subscriptionsCancel = vi.fn(async (id: string) => {
    const subscription = find(id);
    if (subscription.status === 'canceled') {
      throw Object.assign(new Error('A canceled subscription can only update its cancellation_details.'), { type: 'StripeInvalidRequestError' });
    }
    Object.assign(subscription, { status: 'canceled', canceled_at: Math.floor(Date.now() / 1000), ended_at: Math.floor(Date.now() / 1000) });
    return { ...subscription };
  });
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
    subscriptions: { list: fake.subscriptionsList, retrieve: fake.subscriptionsRetrieve, cancel: fake.subscriptionsCancel },
    checkout: { sessions: { create: fake.sessionsCreate, list: fake.sessionsList, expire: fake.sessionsExpire } },
    billingPortal: { sessions: { create: fake.portalCreate } },
  } as unknown as Stripe;
  return fake;
}
