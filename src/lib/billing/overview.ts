import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isLiveSubscriptionStatus,
  pastDueGraceEndsAt,
  resolveEntitlement,
  type EntitlementState,
  type StripeSubscriptionStatus,
} from '@/lib/billing/entitlement';
import {
  PLANS,
  SELF_SERVE_PLAN_IDS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  type BillingInterval,
  type PlanId,
  type SelfServePlanId,
} from '@/lib/billing/plans';
import { missingBillingEnv } from '@/lib/billing/stripe';
import { formatUkLongDate } from '@/lib/utils/date';

/**
 * What the Billing section in Settings shows for the active brand. Read-only;
 * every label is worked out on the server so the client only renders.
 */

export interface BillingSubscriptionSummary {
  plan: PlanId;
  planName: string;
  interval: BillingInterval;
  status: StripeSubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  /** "10 October 2026" style, Europe/London. */
  trialEndLabel: string | null;
  periodEndLabel: string | null;
  /** When a past-due brand stops working (start of the unpaid period plus the grace days). */
  graceEndLabel: string | null;
}

export interface BillingOverview {
  state: EntitlementState;
  subscription: BillingSubscriptionSummary | null;
  /** A Stripe customer exists, so the portal can open. */
  hasCustomer: boolean;
  /**
   * A stored subscription could still bill the brand. Normally only for paying
   * brands; for a comped brand it means Stripe was not cancelled, so owners
   * still get Manage billing to cancel it.
   */
  liveSubscription: boolean;
  /**
   * Whether Checkout will add the free trial. The server gives one only when
   * Stripe lists no earlier CheersAI subscription for the brand's customer:
   * - eligible: no Stripe customer yet, so there cannot be one;
   * - ineligible: a subscription is already recorded;
   * - uncertain: a customer exists but nothing is recorded (for example an
   *   abandoned Checkout, or a subscription not synced), so the page words
   *   the trial as conditional instead of promising it.
   */
  trial: TrialEligibility;
  checkoutReady: boolean;
  portalReady: boolean;
  /** A trial of any plan runs on this plan's limits (spec §2.1). */
  trialLimitsPlan: { plan: PlanId; name: string };
}

export type TrialEligibility = 'eligible' | 'uncertain' | 'ineligible';

export interface BillingPlanOption {
  plan: SelfServePlanId;
  name: string;
  /** "£29.99 + VAT a month" */
  monthlyLabel: string;
  /** "£323.89 + VAT a year" */
  annualLabel: string;
  summary: string;
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

function formatPence(pence: number): string {
  return money.format(pence / 100);
}

export function billingPlanOptions(): BillingPlanOption[] {
  return SELF_SERVE_PLAN_IDS.map((id) => {
    const plan = PLANS[id];
    const limits = plan.limits;
    return {
      plan: id,
      name: plan.name,
      monthlyLabel: plan.monthlyPricePence === null ? '' : `${formatPence(plan.monthlyPricePence)} + VAT a month`,
      annualLabel: plan.annualPricePence === null ? '' : `${formatPence(plan.annualPricePence)} + VAT a year`,
      summary: limits
        ? `${limits.postsPerMonth} posts and ${limits.aiGenerationsPerMonth} AI generations a month, ${limits.seats} people`
        : '',
    };
  });
}

export const BILLING_TRIAL_DAYS = TRIAL_DAYS;

interface SubscriptionRow {
  plan: PlanId;
  billing_interval: BillingInterval;
  status: StripeSubscriptionStatus;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export async function getBillingOverview(service: SupabaseClient, accountId: string, now: Date = new Date()): Promise<BillingOverview> {
  const [accountResult, subscriptionResult, customerResult] = await Promise.all([
    service
      .from('accounts')
      .select('archived_at, billing_override')
      .eq('id', accountId)
      .maybeSingle<{ archived_at: string | null; billing_override: 'comped' | 'suspended' | null }>(),
    // Every stored row for the brand, newest first: the newest decides the
    // state; the rest say whether anything else could still bill it.
    service
      .from('subscriptions')
      .select('plan, billing_interval, status, trial_end, current_period_start, current_period_end, cancel_at_period_end')
      .eq('account_id', accountId)
      .order('stripe_state_at', { ascending: false })
      .limit(50)
      .returns<SubscriptionRow[]>(),
    service.from('billing_customers').select('stripe_customer_id').eq('account_id', accountId).maybeSingle<{ stripe_customer_id: string }>(),
  ]);
  if (accountResult.error) throw new Error(`billing overview: accounts lookup failed: ${accountResult.error.message}`);
  if (!accountResult.data) throw new Error('billing overview: brand not found');
  if (subscriptionResult.error) throw new Error(`billing overview: subscriptions lookup failed: ${subscriptionResult.error.message}`);
  if (customerResult.error) throw new Error(`billing overview: customer lookup failed: ${customerResult.error.message}`);

  const account = accountResult.data;
  const rows = subscriptionResult.data ?? [];
  const row = rows[0] ?? null;
  const state = resolveEntitlement({
    archivedAt: account.archived_at,
    billingOverride: account.billing_override,
    subscription: row
      ? { status: row.status, currentPeriodStart: row.current_period_start ?? null, currentPeriodEnd: row.current_period_end }
      : null,
    now,
  });

  // The same date the entitlement rule uses, so the page and the hold agree.
  const graceEnd =
    row?.status === 'past_due'
      ? pastDueGraceEndsAt({ currentPeriodStart: row.current_period_start ?? null, currentPeriodEnd: row.current_period_end })
      : null;

  return {
    state,
    subscription: row
      ? {
          plan: row.plan,
          planName: PLANS[row.plan]?.name ?? row.plan,
          interval: row.billing_interval,
          status: row.status,
          cancelAtPeriodEnd: row.cancel_at_period_end,
          trialEndLabel: row.trial_end ? formatUkLongDate(row.trial_end) || null : null,
          periodEndLabel: row.current_period_end ? formatUkLongDate(row.current_period_end) || null : null,
          graceEndLabel: graceEnd ? formatUkLongDate(graceEnd) || null : null,
        }
      : null,
    hasCustomer: Boolean(customerResult.data),
    liveSubscription: rows.some((stored) => isLiveSubscriptionStatus(stored.status)),
    trial: rows.length > 0 ? 'ineligible' : customerResult.data ? 'uncertain' : 'eligible',
    checkoutReady: missingBillingEnv('checkout').length === 0,
    portalReady: missingBillingEnv('portal').length === 0,
    trialLimitsPlan: { plan: TRIAL_PLAN, name: PLANS[TRIAL_PLAN].name },
  };
}
