import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

import {
  can,
  isLiveSubscriptionStatus,
  LIVE_SUBSCRIPTION_STATUSES,
  type EntitlementState,
  type StripeSubscriptionStatus,
} from '@/lib/billing/entitlement';
import { getBrandEntitlement } from '@/lib/billing/entitlement-server';
import { planForStripePrice, type BillingInterval, type SelfServePlanId } from '@/lib/billing/plans';
import { releaseHeldPublishJobs } from '@/lib/billing/publish-hold';
import { assertBillingConfigured, CHEERSAI_APP_TAG, getStripe, missingBillingEnv, stripeId } from '@/lib/billing/stripe';
import { createLogger } from '@/lib/logging';
import { alertPossibleDoubleBilling } from '@/lib/notifications/operator-alerts';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Reconcile one brand's subscription from Stripe (spec §4.3).
 *
 * Always reads the current state from Stripe instead of trusting a webhook
 * payload, so events arriving late or out of order cannot leave a wrong state.
 * Used by the webhook, the "Check again" button after Checkout and the admin
 * "Re-sync from Stripe" button: one code path for all three.
 *
 * Only Stripe-owned fields are written (the subscriptions table); operator
 * state (accounts.billing_override) is never touched. Every write carries the
 * time the state was read from Stripe (stripe_state_at) and only replaces a
 * row holding an older state, so a slow, older reconcile never overwrites a
 * newer one.
 */

const logger = createLogger('billing');

export type ReconcileOutcome = 'synced' | 'stale' | 'no_customer' | 'no_subscription';

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  subscriptionId: string | null;
  status: StripeSubscriptionStatus | null;
  state: EntitlementState;
  /** Held posts put back in the queue because the brand may publish again. */
  released: number;
  stillHeld: number;
}

export interface ReconcileDeps {
  service?: SupabaseClient;
  stripe?: Stripe;
  now?: () => Date;
}

/** A subscription that cannot be stored safely (unknown price or status, wrong brand). */
export class ReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconcileError';
  }
}

/** Mirrors public.subscriptions (all columns the webhook owns). */
export interface SubscriptionRow {
  stripe_subscription_id: string;
  account_id: string;
  stripe_customer_id: string;
  status: StripeSubscriptionStatus;
  plan: SelfServePlanId;
  billing_interval: BillingInterval;
  stripe_price_id: string;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  stripe_state_at: string;
  updated_at: string;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set<StripeSubscriptionStatus>([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

/**
 * Which subscription decides the brand's state when a customer has several
 * (for example an old cancelled one and a new trial): live ones first, then
 * ones still waiting on payment, then ended ones; newest first within each.
 */
const STATUS_RANK: Record<StripeSubscriptionStatus, number> = {
  active: 3,
  trialing: 3,
  past_due: 3,
  unpaid: 2,
  paused: 2,
  incomplete: 2,
  canceled: 1,
  incomplete_expired: 0,
};

function toIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

/** The subscription item on a CheersAI price, if any. */
function cheersItem(subscription: Stripe.Subscription): { item: Stripe.SubscriptionItem; plan: SelfServePlanId; interval: BillingInterval } | null {
  for (const item of subscription.items?.data ?? []) {
    if (!item.price) continue;
    const match = planForStripePrice(item.price);
    if (match) return { item, ...match };
  }
  return null;
}

/** True when the subscription was made by CheersAI (tagged, or on a CheersAI price). */
export function isCheersSubscription(subscription: Stripe.Subscription): boolean {
  return subscription.metadata?.app === CHEERSAI_APP_TAG || cheersItem(subscription) !== null;
}

export function pickCurrentSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
  const ranked = [...subscriptions].sort((a, b) => {
    const rankA = STATUS_RANK[a.status as StripeSubscriptionStatus] ?? -1;
    const rankB = STATUS_RANK[b.status as StripeSubscriptionStatus] ?? -1;
    return rankB - rankA || b.created - a.created;
  });
  return ranked[0] ?? null;
}

/** Map a Stripe subscription onto the subscriptions row. Throws ReconcileError when it cannot be stored. */
export function mapStripeSubscription(
  subscription: Stripe.Subscription,
  context: { accountId: string; customerId: string; stateAt: Date; now: Date },
): SubscriptionRow {
  if (!KNOWN_STATUSES.has(subscription.status)) {
    throw new ReconcileError(`Unknown Stripe subscription status "${subscription.status}" on ${subscription.id}`);
  }
  const taggedAccount = subscription.metadata?.account_id;
  if (taggedAccount && taggedAccount !== context.accountId) {
    throw new ReconcileError(`Subscription ${subscription.id} is tagged for another brand`);
  }
  if (stripeId(subscription.customer) !== context.customerId) {
    throw new ReconcileError(`Subscription ${subscription.id} belongs to another Stripe customer`);
  }
  const match = cheersItem(subscription);
  if (!match) {
    throw new ReconcileError(`Subscription ${subscription.id} is not on a configured CheersAI price`);
  }

  return {
    stripe_subscription_id: subscription.id,
    account_id: context.accountId,
    stripe_customer_id: context.customerId,
    status: subscription.status as StripeSubscriptionStatus,
    plan: match.plan,
    billing_interval: match.interval,
    stripe_price_id: match.item.price.id,
    trial_end: toIso(subscription.trial_end),
    // Both period dates live on the subscription item in this API version. For
    // a past-due subscription the start is when the unpaid period began.
    current_period_start: toIso(match.item.current_period_start),
    current_period_end: toIso(match.item.current_period_end),
    // Newer API versions can schedule the end with cancel_at instead of the flag.
    cancel_at_period_end: subscription.cancel_at_period_end || subscription.cancel_at !== null,
    canceled_at: toIso(subscription.canceled_at),
    stripe_state_at: context.stateAt.toISOString(),
    updated_at: context.now.toISOString(),
  };
}

type WriteOutcome = 'written' | 'stale' | 'absent';

/** Replace the row only if it holds an older state; insert it when missing (if allowed). */
async function writeSubscriptionRow(service: SupabaseClient, row: SubscriptionRow, insertIfMissing: boolean): Promise<WriteOutcome> {
  const conditionalUpdate = async (): Promise<boolean> => {
    const { data, error } = await service
      .from('subscriptions')
      .update(row)
      .eq('stripe_subscription_id', row.stripe_subscription_id)
      .eq('account_id', row.account_id)
      .lt('stripe_state_at', row.stripe_state_at)
      .select('stripe_subscription_id');
    if (error) throw new Error(`subscriptions update failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  };

  if (await conditionalUpdate()) return 'written';

  const { data: existing, error: existingError } = await service
    .from('subscriptions')
    .select('account_id')
    .eq('stripe_subscription_id', row.stripe_subscription_id)
    .maybeSingle<{ account_id: string }>();
  if (existingError) throw new Error(`subscriptions lookup failed: ${existingError.message}`);
  if (existing) {
    if (existing.account_id !== row.account_id) {
      throw new ReconcileError(`Subscription ${row.stripe_subscription_id} is stored against another brand`);
    }
    return 'stale';
  }
  if (!insertIfMissing) return 'absent';

  const { error: insertError } = await service.from('subscriptions').insert(row);
  if (!insertError) return 'written';
  // Another reconcile inserted it first: fall back to the conditional update.
  if (insertError.code === '23505') return (await conditionalUpdate()) ? 'written' : 'stale';
  throw new Error(`subscriptions insert failed: ${insertError.message}`);
}

async function loadCustomerId(service: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await service
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('account_id', accountId)
    .maybeSingle<{ stripe_customer_id: string }>();
  if (error) throw new Error(`billing_customers lookup failed: ${error.message}`);
  return data?.stripe_customer_id ?? null;
}

/**
 * List every CheersAI subscription on a Stripe customer (all statuses). Throws
 * rather than work from a partial list: reconcile marks stored subscriptions
 * Stripe does not list as cancelled, so a truncated list must never be used.
 */
export async function listCheersSubscriptions(stripe: Stripe, customerId: string): Promise<Stripe.Subscription[]> {
  const page = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  if (page.has_more) {
    throw new ReconcileError(`Stripe customer ${customerId} has more than 100 subscriptions; reconcile it by hand`);
  }
  return page.data.filter(isCheersSubscription);
}

/**
 * Whether the brand may still be billed by a CheersAI subscription: a stored
 * row in a live status, or (when Stripe is configured and the brand has a
 * customer) a live one Stripe lists now. Every lookup is scoped to the brand
 * and throws on failure, so callers can fail closed.
 */
export async function hasLiveCheersSubscription(
  service: SupabaseClient,
  accountId: string,
  deps: { stripe?: Stripe } = {},
): Promise<boolean> {
  const { data, error } = await service
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('account_id', accountId)
    .in('status', [...LIVE_SUBSCRIPTION_STATUSES])
    .limit(1);
  if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
  if ((data?.length ?? 0) > 0) return true;

  if (missingBillingEnv('reconcile').length) return false;
  const customerId = await loadCustomerId(service, accountId);
  if (!customerId) return false;
  const subscriptions = await listCheersSubscriptions(deps.stripe ?? getStripe(), customerId);
  return subscriptions.some((subscription) => isLiveSubscriptionStatus(subscription.status));
}

/**
 * Stored live rows for this brand that Stripe no longer lists (deleted in
 * Stripe, or no longer on the brand's customer) would otherwise keep the
 * brand's access and seats forever. Mark them cancelled at `stateAt`, only
 * where the stored state is older, and log a warning.
 */
async function cancelRowsStripeNoLongerLists(
  service: SupabaseClient,
  accountId: string,
  listedIds: ReadonlySet<string>,
  stateAt: Date,
  now: Date,
): Promise<string[]> {
  const { data, error } = await service
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('account_id', accountId)
    .in('status', [...LIVE_SUBSCRIPTION_STATUSES]);
  if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);

  const cancelled: string[] = [];
  for (const { stripe_subscription_id: id } of (data ?? []) as Array<{ stripe_subscription_id: string }>) {
    if (listedIds.has(id)) continue;
    const { data: updated, error: updateError } = await service
      .from('subscriptions')
      .update({ status: 'canceled', stripe_state_at: stateAt.toISOString(), updated_at: now.toISOString() })
      .eq('stripe_subscription_id', id)
      .eq('account_id', accountId)
      .lt('stripe_state_at', stateAt.toISOString())
      .select('stripe_subscription_id');
    if (updateError) throw new Error(`subscriptions update failed: ${updateError.message}`);
    if ((updated?.length ?? 0) > 0) cancelled.push(id);
  }
  if (cancelled.length) {
    logger.warn('Stripe no longer lists these CheersAI subscriptions; stored rows marked canceled', { accountId, subscriptionIds: cancelled });
  }
  return cancelled;
}

/**
 * More than one live CheersAI subscription on one customer may mean the brand
 * is billed twice: tell the operator. The alert never blocks the reconcile; a
 * failure to send it is logged as an error.
 */
async function warnIfBilledTwice(
  service: SupabaseClient,
  accountId: string,
  customerId: string,
  subscriptions: Stripe.Subscription[],
): Promise<void> {
  const live = subscriptions.filter((subscription) => isLiveSubscriptionStatus(subscription.status));
  if (live.length < 2) return;
  const subscriptionIds = live.map((subscription) => subscription.id);
  logger.error('brand has more than one live CheersAI subscription (possible double billing)', undefined, {
    accountId,
    customerId,
    subscriptionIds,
  });
  try {
    await alertPossibleDoubleBilling(service, { accountId, customerId, subscriptionIds });
  } catch (error) {
    logger.error('operator alert for possible double billing could not be sent', error instanceof Error ? error : undefined, { accountId });
  }
}

async function finish(
  service: SupabaseClient,
  accountId: string,
  now: Date,
  partial: Pick<ReconcileResult, 'outcome' | 'subscriptionId' | 'status'>,
): Promise<ReconcileResult> {
  const state = await getBrandEntitlement(service, accountId, now);
  let released = 0;
  let stillHeld = 0;
  if (can(state, 'publish')) {
    ({ released, stillHeld } = await releaseHeldPublishJobs(service, accountId, now));
  }
  return { ...partial, state, released, stillHeld };
}

export async function reconcileBrandFromStripe(accountId: string, deps: ReconcileDeps = {}): Promise<ReconcileResult> {
  assertBillingConfigured('reconcile');
  const service = deps.service ?? createServiceSupabaseClient();
  const stripe = deps.stripe ?? getStripe();
  const clock = deps.now ?? (() => new Date());

  const customerId = await loadCustomerId(service, accountId);
  if (!customerId) {
    return finish(service, accountId, clock(), { outcome: 'no_customer', subscriptionId: null, status: null });
  }

  // The state read below is at least as new as this moment.
  const stateAt = clock();
  const subscriptions = await listCheersSubscriptions(stripe, customerId);
  const listedIds = new Set(subscriptions.map((subscription) => subscription.id));
  await warnIfBilledTwice(service, accountId, customerId, subscriptions);
  const current = pickCurrentSubscription(subscriptions);
  if (!current) {
    // Nothing in Stripe any more: stored live rows must stop granting access.
    await cancelRowsStripeNoLongerLists(service, accountId, listedIds, stateAt, clock());
    return finish(service, accountId, clock(), { outcome: 'no_subscription', subscriptionId: null, status: null });
  }

  const now = clock();
  const row = mapStripeSubscription(current, { accountId, customerId, stateAt, now });
  const outcome = await writeSubscriptionRow(service, row, true);

  // Keep older rows for this customer truthful (a stale "active" row must not
  // keep granting seats), one millisecond older so the current one stays newest.
  const olderStateAt = new Date(stateAt.getTime() - 1);
  for (const other of subscriptions) {
    if (other.id === current.id) continue;
    let otherRow: SubscriptionRow;
    try {
      otherRow = mapStripeSubscription(other, { accountId, customerId, stateAt: olderStateAt, now });
    } catch (error) {
      logger.warn('skipped an older subscription that cannot be mapped', {
        accountId,
        subscriptionId: other.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    await writeSubscriptionRow(service, otherRow, false);
  }
  await cancelRowsStripeNoLongerLists(service, accountId, listedIds, olderStateAt, now);

  logger.info('reconciled brand from Stripe', { accountId, subscriptionId: current.id, status: row.status, outcome });
  return finish(service, accountId, now, {
    outcome: outcome === 'written' ? 'synced' : 'stale',
    subscriptionId: current.id,
    status: row.status,
  });
}
