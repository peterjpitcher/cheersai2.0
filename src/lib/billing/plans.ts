import { env } from '@/env';

/**
 * CheersAI plans (SPEC-new-customer-readiness §2.1, approved 2026-09-24).
 * The single source of plan limits: nothing else may hard-code them.
 * Prices are ex VAT and live in Stripe; this file holds only what the app
 * enforces, plus the one mapping between Stripe price ids and plans. Price
 * ids come from server-only env vars, never from the browser. Server-only
 * module: client components receive plan details as props.
 */
export type PlanId = 'starter' | 'professional' | 'group';

/** Plans a brand can buy through Checkout. Group is sold by contact. */
export type SelfServePlanId = 'starter' | 'professional';
export const SELF_SERVE_PLAN_IDS = ['starter', 'professional'] as const satisfies readonly SelfServePlanId[];

/** Matches subscriptions.billing_interval. */
export type BillingInterval = 'month' | 'year';
export const BILLING_INTERVALS = ['month', 'year'] as const satisfies readonly BillingInterval[];

export interface PlanLimits {
  /** Published posts per billing month (each Facebook or Instagram placement counts). */
  postsPerMonth: number;
  /** OpenAI generation requests per billing month. */
  aiGenerationsPerMonth: number;
  /** Retained media storage, bytes. */
  storageBytes: number;
  /** People with access to the brand, including the owner. */
  seats: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Display prices in pence, ex VAT. Stripe is authoritative for charging. */
  monthlyPricePence: number | null;
  annualPricePence: number | null;
  /** Null for Group: limits are agreed per contract and stored per brand later. */
  limits: PlanLimits | null;
  selfServe: boolean;
}

const GB = 1024 * 1024 * 1024;

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyPricePence: 2999,
    annualPricePence: 32389,
    limits: { postsPerMonth: 120, aiGenerationsPerMonth: 150, storageBytes: 2 * GB, seats: 2 },
    selfServe: true,
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    monthlyPricePence: 5999,
    annualPricePence: 64789,
    limits: { postsPerMonth: 400, aiGenerationsPerMonth: 500, storageBytes: 10 * GB, seats: 5 },
    selfServe: true,
  },
  group: {
    id: 'group',
    name: 'Group',
    monthlyPricePence: null,
    annualPricePence: null,
    limits: null,
    selfServe: false,
  },
};

/** Trials run on Starter limits (spec §2.1). */
export const TRIAL_PLAN: PlanId = 'starter';
export const TRIAL_DAYS = 14;

/**
 * The only mapping between Stripe prices and plans. Each value names the
 * server env var that holds the price id for that plan and interval, so test
 * and live mode can use their own prices without a code change.
 */
export const STRIPE_PRICE_ENV_KEYS = {
  starter: { month: 'STRIPE_PRICE_STARTER_MONTHLY', year: 'STRIPE_PRICE_STARTER_ANNUAL' },
  professional: { month: 'STRIPE_PRICE_PROFESSIONAL_MONTHLY', year: 'STRIPE_PRICE_PROFESSIONAL_ANNUAL' },
} as const satisfies Record<SelfServePlanId, Record<BillingInterval, keyof typeof env.server>>;

export type StripePriceEnvKey = (typeof STRIPE_PRICE_ENV_KEYS)[SelfServePlanId][BillingInterval];

export const ALL_STRIPE_PRICE_ENV_KEYS: readonly StripePriceEnvKey[] = SELF_SERVE_PLAN_IDS.flatMap((plan) =>
  BILLING_INTERVALS.map((interval) => STRIPE_PRICE_ENV_KEYS[plan][interval]),
);

/** The configured Stripe price id for a plan and interval, or null when unset. */
export function stripePriceIdFor(plan: SelfServePlanId, interval: BillingInterval): string | null {
  const value = env.server[STRIPE_PRICE_ENV_KEYS[plan][interval]];
  return value ? value : null;
}

/** The parts of a Stripe price the plan mapping reads (a Stripe.Price fits). */
export interface StripePriceLike {
  id: string;
  metadata?: Record<string, string> | null;
  lookup_key?: string | null;
  recurring?: { interval?: string | null } | null;
}

export interface PriceMatch {
  plan: SelfServePlanId;
  interval: BillingInterval;
}

const INTERVAL_WORDS: Record<string, BillingInterval> = {
  month: 'month',
  monthly: 'month',
  year: 'year',
  yearly: 'year',
  annual: 'year',
};

function isSelfServePlan(value: string | undefined | null): value is SelfServePlanId {
  return (SELF_SERVE_PLAN_IDS as readonly string[]).includes(value ?? '');
}

/** Price metadata set when the CheersAI prices were created: app=cheersai, plan, interval. */
function planFromMetadata(metadata: StripePriceLike['metadata']): PriceMatch | null {
  if (!metadata || metadata.app !== 'cheersai') return null;
  const interval = INTERVAL_WORDS[(metadata.interval ?? '').toLowerCase()];
  return isSelfServePlan(metadata.plan) && interval ? { plan: metadata.plan, interval } : null;
}

const LOOKUP_KEY_PATTERN = /^cheers_(starter|professional)_(monthly|annual)$/;

/** Lookup keys of the form cheers_<plan>_<monthly|annual>. */
function planFromLookupKey(lookupKey: StripePriceLike['lookup_key']): PriceMatch | null {
  const match = LOOKUP_KEY_PATTERN.exec(lookupKey ?? '');
  if (!match || !isSelfServePlan(match[1])) return null;
  return { plan: match[1], interval: INTERVAL_WORDS[match[2]] };
}

/**
 * Which plan and interval a Stripe price belongs to, or null for any other
 * price (for example the management app's). The configured env price ids win;
 * after that the price's own metadata or lookup key, so a replaced or
 * grandfathered CheersAI price keeps mapping to its plan instead of freezing
 * its subscribers. A label that disagrees with how Stripe actually bills the
 * price (its recurring interval) is not trusted.
 */
export function planForStripePrice(price: StripePriceLike | string): PriceMatch | null {
  const candidate: StripePriceLike = typeof price === 'string' ? { id: price } : price;
  if (!candidate.id) return null;
  for (const plan of SELF_SERVE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (stripePriceIdFor(plan, interval) === candidate.id) return { plan, interval };
    }
  }
  const labelled = planFromMetadata(candidate.metadata) ?? planFromLookupKey(candidate.lookup_key);
  if (!labelled) return null;
  const billed = candidate.recurring?.interval;
  if (billed && billed !== labelled.interval) return null;
  return labelled;
}
