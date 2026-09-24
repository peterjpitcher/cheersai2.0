import type { SupabaseClient } from '@supabase/supabase-js';

import { featureFlags } from '@/env';
import { requireAuthContext } from '@/lib/auth/server';
import type { AuthContext } from '@/lib/auth/types';
import {
  can,
  resolveEntitlement,
  type Capability,
  type EntitlementState,
  type StripeSubscriptionStatus,
} from '@/lib/billing/entitlement';

/**
 * Server side of brand entitlement (spec §4.1, decision D3).
 *
 * While BILLING_ENFORCEMENT_ENABLED is off (the default) nothing here blocks
 * anything and the database is not consulted. When on, a held brand (lapsed,
 * incomplete, suspended) may still read, manage billing and export, but not
 * create or publish. Every guarded action re-checks the brand it acts on, so a
 * stale form cannot write to a brand that has since lapsed. A lookup failure
 * throws: it is an error, never a silent pass.
 */

export class EntitlementError extends Error {
  constructor(public readonly state: EntitlementState) {
    super(ENTITLEMENT_MESSAGES[state] ?? 'This brand cannot do that right now.');
    this.name = 'EntitlementError';
  }
}

export const ENTITLEMENT_MESSAGES: Partial<Record<EntitlementState, string>> = {
  lapsed: 'This brand is on hold because its subscription has lapsed. An owner can restart it from Billing.',
  incomplete: 'This brand has not finished setting up billing yet. An owner can finish it from Billing.',
  suspended: 'This brand is on hold. Contact Cheers support.',
  archived: 'This brand has been closed.',
};

export async function getBrandEntitlement(
  service: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<EntitlementState> {
  const { data: account, error: accountError } = await service
    .from('accounts')
    .select('archived_at, billing_override')
    .eq('id', accountId)
    .maybeSingle<{ archived_at: string | null; billing_override: 'comped' | 'suspended' | null }>();
  if (accountError) throw new Error(`entitlement: accounts lookup failed: ${accountError.message}`);
  if (!account) throw new Error('entitlement: brand not found');

  // Operator states need no Stripe lookup.
  if (account.archived_at || account.billing_override) {
    return resolveEntitlement({
      archivedAt: account.archived_at,
      billingOverride: account.billing_override,
      subscription: null,
      now,
    });
  }

  const { data: subscription, error: subscriptionError } = await service
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('account_id', accountId)
    .order('stripe_state_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ status: StripeSubscriptionStatus; current_period_end: string | null }>();
  if (subscriptionError) throw new Error(`entitlement: subscriptions lookup failed: ${subscriptionError.message}`);

  return resolveEntitlement({
    archivedAt: null,
    billingOverride: null,
    subscription: subscription ? { status: subscription.status, currentPeriodEnd: subscription.current_period_end } : null,
    now,
  });
}

/** Throws EntitlementError when enforcement is on and the brand lacks the capability. */
export async function assertEntitled(ctx: Pick<AuthContext, 'supabase' | 'accountId'>, capability: Capability): Promise<void> {
  if (!featureFlags.billingEnforcement) return;
  const state = await getBrandEntitlement(ctx.supabase, ctx.accountId);
  if (!can(state, capability)) throw new EntitlementError(state);
}

/** requireAuthContext() plus the entitlement check for `capability`. */
export async function requireEntitledContext(capability: Capability): Promise<AuthContext> {
  const ctx = await requireAuthContext();
  await assertEntitled(ctx, capability);
  return ctx;
}
