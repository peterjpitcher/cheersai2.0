import { PLANS, SELF_SERVE_PLAN_IDS, TRIAL_DAYS, TRIAL_PLAN, type PlanId } from '@/lib/billing/plans';

/**
 * The landing page's prices (SPEC-self-serve-signup §4.1). Every price and
 * limit comes from PLANS, so the page can never disagree with what Checkout
 * sells. Venues and support come from the terms (sections 4 and 16). Prices
 * are ex VAT (decision L2); the page says so next to every price.
 */

export interface PriceCard {
  id: PlanId;
  name: string;
  /** "£29.99", or null for Group (by agreement). */
  monthlyAmount: string | null;
  /** "£29.99 a month", or null for Group (by agreement). */
  monthly: string | null;
  /** "£323.89 a year", or null for Group. */
  annual: string | null;
  /** Whole-percent saving from paying yearly (10 today), or null when there is none. */
  yearlySaving: number | null;
  /** Limits and support, one line each. */
  includes: string[];
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const GB = 1024 * 1024 * 1024;

/** "£29.99" from 2999 pence. */
export function formatPounds(pence: number): string {
  return money.format(pence / 100);
}

function price(pence: number | null, period: 'month' | 'year'): string | null {
  return pence === null ? null : `${formatPounds(pence)} a ${period}`;
}

/**
 * The saving from paying yearly, as a whole percentage of twelve monthly
 * payments (Starter: £323.89 against 12 x £29.99 is 10%), or null when a plan
 * has no yearly price or no saving. Worked out from PLANS, never typed in, and
 * shown as a percentage so no price appears that PLANS does not hold.
 */
export function yearlySavingPercent(id: PlanId): number | null {
  const { monthlyPricePence: monthly, annualPricePence: annual } = PLANS[id];
  if (monthly === null || annual === null) return null;
  const percent = Math.round((1 - annual / (monthly * 12)) * 100);
  return percent > 0 ? percent : null;
}

/** The lowest monthly price a venue can buy online ("£29.99"), or null if none has a price. */
export function lowestMonthlyPrice(): string | null {
  const prices = SELF_SERVE_PLAN_IDS.map((id) => PLANS[id].monthlyPricePence).filter(
    (pence): pence is number => pence !== null,
  );
  return prices.length ? formatPounds(Math.min(...prices)) : null;
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
      monthlyAmount: plan.monthlyPricePence === null ? null : formatPounds(plan.monthlyPricePence),
      monthly: price(plan.monthlyPricePence, 'month'),
      annual: price(plan.annualPricePence, 'year'),
      yearlySaving: yearlySavingPercent(id),
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
