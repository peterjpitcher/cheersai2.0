/**
 * CheersAI plans (SPEC-new-customer-readiness §2.1, approved 2026-09-24).
 * The single source of plan limits: nothing else may hard-code them.
 * Prices are ex VAT and live in Stripe; this file holds only what the app
 * enforces. Stripe price ids are resolved from server env in the Stripe
 * integration (piece 2.3), never from the browser.
 */
export type PlanId = 'starter' | 'professional' | 'group';

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
