import type { SupabaseClient } from '@supabase/supabase-js';

import { PLANS, TRIAL_PLAN, type PlanId } from '@/lib/billing/plans';

/** Subscriptions that still grant their plan's seats. */
const SEAT_GRANTING_STATUSES = ['trialing', 'active', 'past_due'];

/**
 * How many people may have access to a brand (spec §2.1 seats).
 * null means unlimited (comped brands, Group plans agreed by contract).
 * Suspended brands get 0: no new people while held. A brand with no
 * subscription yet is treated as on the trial plan. Lookup errors throw, so
 * an invite fails closed rather than skipping the limit.
 */
export async function getSeatLimit(service: SupabaseClient, accountId: string): Promise<number | null> {
  const { data: account, error: accountError } = await service
    .from('accounts')
    .select('billing_override')
    .eq('id', accountId)
    .maybeSingle<{ billing_override: 'comped' | 'suspended' | null }>();
  if (accountError) throw new Error(`accounts lookup failed: ${accountError.message}`);
  if (account?.billing_override === 'comped') return null;
  if (account?.billing_override === 'suspended') return 0;

  const { data: subscription, error: subscriptionError } = await service
    .from('subscriptions')
    .select('plan')
    .eq('account_id', accountId)
    .in('status', SEAT_GRANTING_STATUSES)
    .order('stripe_state_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ plan: PlanId }>();
  if (subscriptionError) throw new Error(`subscriptions lookup failed: ${subscriptionError.message}`);

  const plan = PLANS[subscription?.plan ?? TRIAL_PLAN];
  return plan.limits ? plan.limits.seats : null;
}
