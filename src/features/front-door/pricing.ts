import { PLANS, TRIAL_DAYS, TRIAL_PLAN, type PlanId } from '@/lib/billing/plans';

/**
 * The landing page's prices (SPEC-self-serve-signup §4.1). Every price and
 * limit comes from PLANS, so the page can never disagree with what Checkout
 * sells. Venues and support come from the terms (sections 4 and 16). Prices
 * are ex VAT (decision L2); the page says so next to every price.
 */

export interface PriceCard {
  id: PlanId;
  name: string;
  /** "£29.99 a month", or null for Group (by agreement). */
  monthly: string | null;
  /** "£323.89 a year", or null for Group. */
  annual: string | null;
  /** Limits and support, one line each. */
  includes: string[];
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const GB = 1024 * 1024 * 1024;

function price(pence: number | null, period: 'month' | 'year'): string | null {
  return pence === null ? null : `${money.format(pence / 100)} a ${period}`;
}

/** Terms section 16. */
const SUPPORT: Record<PlanId, string> = {
  starter: 'Email support',
  professional: 'Priority email and WhatsApp support',
  group: 'A named contact',
};

/** Terms section 4 ("Venues"). */
const VENUES: Record<PlanId, string> = {
  starter: 'One venue',
  professional: 'One venue',
  group: 'Several venues',
};

export function priceCards(): PriceCard[] {
  return (['starter', 'professional', 'group'] as const).map((id) => {
    const plan = PLANS[id];
    const limits = plan.limits;
    const includes = limits
      ? [
          VENUES[id],
          `${limits.postsPerMonth} published posts a month`,
          `${limits.aiGenerationsPerMonth} AI generations a month`,
          `${limits.storageBytes / GB} GB media storage`,
          `${limits.seats} team seats`,
          SUPPORT[id],
        ]
      : [VENUES[id], 'Price and limits agreed with you in writing', SUPPORT[id]];
    return {
      id,
      name: plan.name,
      monthly: price(plan.monthlyPricePence, 'month'),
      annual: price(plan.annualPricePence, 'year'),
      includes,
    };
  });
}

/** The trial, worded as terms section 5 words it. */
export function trialLines(): string[] {
  return [
    `New subscriptions start with a ${TRIAL_DAYS}-day free trial, one per business. We take your card details at the start.`,
    `Your first payment is taken on day ${TRIAL_DAYS + 1}, unless you cancel before then.`,
    `During the trial, the ${PLANS[TRIAL_PLAN].name} limits apply, whichever plan you choose.`,
  ];
}
