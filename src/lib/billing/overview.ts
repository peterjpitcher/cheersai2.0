import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PAST_DUE_GRACE_DAYS,
  resolveEntitlement,
  type EntitlementState,
  type StripeSubscriptionStatus,
} from '@/lib/billing/entitlement';
import { PLANS, SELF_SERVE_PLAN_IDS, TRIAL_DAYS, type BillingInterval, type PlanId, type SelfServePlanId } from '@/lib/billing/plans';
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
  /** When a past-due brand stops working (paid period end plus the grace days). */
  graceEndLabel: string | null;
}

export interface BillingOverview {
  state: EntitlementState;
  subscription: BillingSubscriptionSummary | null;
  /** A Stripe customer exists, so the portal can open. */
  hasCustomer: boolean;
  /** No subscription has ever been recorded for this brand, so Checkout adds the free trial. */
  trialEligible: boolean;
  checkoutReady: boolean;
  portalReady: boolean;
}

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
    service
      .from('subscriptions')
      .select('plan, billing_interval, status, trial_end, current_period_end, cancel_at_period_end')
      .eq('account_id', accountId)
      .order('stripe_state_at', { ascending: false })
      .limit(1)
      .maybeSingle<SubscriptionRow>(),
    service.from('billing_customers').select('stripe_customer_id').eq('account_id', accountId).maybeSingle<{ stripe_customer_id: string }>(),
  ]);
  if (accountResult.error) throw new Error(`billing overview: accounts lookup failed: ${accountResult.error.message}`);
  if (!accountResult.data) throw new Error('billing overview: brand not found');
  if (subscriptionResult.error) throw new Error(`billing overview: subscriptions lookup failed: ${subscriptionResult.error.message}`);
  if (customerResult.error) throw new Error(`billing overview: customer lookup failed: ${customerResult.error.message}`);

  const account = accountResult.data;
  const row = subscriptionResult.data;
  const state = resolveEntitlement({
    archivedAt: account.archived_at,
    billingOverride: account.billing_override,
    subscription: row ? { status: row.status, currentPeriodEnd: row.current_period_end } : null,
    now,
  });

  const graceEnd =
    row?.current_period_end && !Number.isNaN(Date.parse(row.current_period_end))
      ? new Date(Date.parse(row.current_period_end) + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000)
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
    trialEligible: !row,
    checkoutReady: missingBillingEnv('checkout').length === 0,
    portalReady: missingBillingEnv('portal').length === 0,
  };
}
