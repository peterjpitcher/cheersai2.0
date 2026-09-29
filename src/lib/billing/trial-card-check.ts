import { createHmac } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

import { BillingNotConfiguredError, usableTrialCardHashKey } from '@/lib/billing/stripe';
import { createLogger } from '@/lib/logging';
import {
  alertRefusedTrialNotOnCustomer,
  alertTrialRefusedRepeatCard,
  alertTrialStartedWithoutCard,
} from '@/lib/notifications/operator-alerts';

/**
 * Repeat free trials, checked by card (SPEC-self-serve-signup §4.7, decisions
 * L6 and P5): one free trial per card, across every brand.
 *
 * Runs inside reconcileBrandFromStripe after the current subscription row is
 * written and before finish(), so the webhook, "Check again" and the admin
 * re-sync all share it. Only a free trial that started with its subscription
 * (the trial CheersAI's Checkout gives) is checked: a subscription moved into a
 * trial later (for example a free month given in the Stripe Dashboard) is left
 * alone and nothing is recorded. Anything else costs one or two database reads
 * and no Stripe call, so brands with no trial (every comped brand today) are
 * unaffected.
 *
 * The decision, race-safe because Stripe's events for one Checkout arrive
 * together and reconcile concurrently:
 *   1. insert (subscription, card code, 'first_trial'). Inserted: done.
 *   2. A unique violation: read this subscription's row. Present: a parallel
 *      reconcile already decided; use its outcome. Absent: the violation should
 *      be the partial unique index on card_hash (another subscription holds
 *      this card's trial). That is confirmed (a first_trial row exists for the
 *      code) before 'repeat_refused' is inserted, so a primary-key clash with a
 *      row that has since gone is never read as a card clash; a unique
 *      violation on that insert means a parallel reconcile inserted it first,
 *      so use its row.
 *   3. Only the reconcile that inserted 'repeat_refused' cancels the trial in
 *      Stripe (invoice_now false, prorate false; "already cancelled" counts
 *      as success), stores the cancelled subscription row from Stripe's
 *      answer (so finish() sees the cancellation, not the trial), emails the
 *      operator, records trial_refused_repeat_card in admin_audit (once per
 *      subscription) and finally sets cancelled_at. cancelled_at is the "all
 *      done" marker, set last, so a failure at any step leaves it empty and
 *      the refusal is finished by a later reconcile (see finishRefusal).
 *   4. No card on the subscription: 'no_card', and the operator is emailed.
 * Every Stripe or database error throws, so the webhook answers 500, Stripe
 * retries and the existing webhook alert emails the operator. The trial runs
 * meanwhile (a visible gap in billing control, spec §9).
 *
 * The card code is HMAC-SHA256 of the card's Stripe fingerprint with
 * TRIAL_CARD_HASH_KEY. No card data is stored, logged or emailed, and the
 * code itself never leaves the database.
 */

const logger = createLogger('billing');

export type TrialCardOutcome = 'first_trial' | 'repeat_refused' | 'no_card';

/**
 * Trials Stripe created before this moment (13:00 London time, 28 September
 * 2026, when this check was written) are recorded as first_trial when their
 * card is free, but never refused (spec §4.7 "When"). It is earlier than the
 * deploy, which is safe only while no trial starts in production between the
 * two: on 28 September 2026 production had no trialing subscription at all
 * (one cancelled test, created at 08:07 UTC), and the deploy checklist
 * re-checks that count before merging.
 */
export const TRIAL_CARD_CHECK_STARTS_AT = new Date('2026-09-28T12:00:00.000Z');

/**
 * How close (in seconds) a subscription's trial_start must be to its creation
 * (created or start_date) for the trial to count as the one it started with.
 * CheersAI's Checkout creates the subscription and its trial in one step, so
 * the two match to the second; a trial added to a running subscription starts
 * whenever it was added.
 */
export const TRIAL_FROM_CREATION_TOLERANCE_SECONDS = 60;

/** True when the subscription's trial began when the subscription was created. */
export function trialBeganAtCreation(subscription: Pick<Stripe.Subscription, 'trial_start' | 'created' | 'start_date'>): boolean {
  const trialStart = subscription.trial_start;
  if (typeof trialStart !== 'number') return false;
  const near = (other: number | null | undefined): boolean =>
    typeof other === 'number' && Math.abs(trialStart - other) <= TRIAL_FROM_CREATION_TOLERANCE_SECONDS;
  return near(subscription.created) || near(subscription.start_date);
}

/** card_hash for a no_card row (the table's CHECK allows it only with that outcome). */
export const NO_CARD_HASH = 'none';

/**
 * A reconcile that finds a refusal another reconcile inserted, not yet
 * finished, waits this many polls of this many milliseconds for it to finish
 * (a Stripe cancel, two database writes and one email: normally a second or
 * two) before giving up with an error, so the webhook answers 500 and Stripe
 * redelivers the event later.
 */
const REFUSAL_WAIT_POLLS = 20;
const REFUSAL_POLL_MS = 1000;

/**
 * After this long, an unfinished refusal is taken to have lost its reconcile
 * (it threw or was killed) and the next reconcile finishes it. Longer than
 * any one reconcile can run, so two reconciles never cancel the same trial at
 * once in the normal case.
 */
export const REFUSAL_TAKEOVER_AFTER_MS = 10 * 60 * 1000;

/** The repeat-trial check could not finish; the reconcile must fail so it is retried. */
export class TrialCardCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrialCardCheckError';
  }
}

export interface TrialCardCheckResult {
  /** The current subscription's recorded outcome, or null when it has none (not a trial, a trial added after creation, or grandfathered). */
  outcome: TrialCardOutcome | null;
  /** The current subscription is a refused trial (already cancelled in Stripe when this returns). */
  refused: boolean;
}

export interface TrialCardCheckInput {
  service: SupabaseClient;
  stripe: Stripe;
  accountId: string;
  customerId: string;
  /** The subscription that decides the brand's state (reconcile's pickCurrentSubscription). */
  current: Stripe.Subscription;
  /** Every CheersAI subscription Stripe lists for the customer, current included. */
  listed: readonly Stripe.Subscription[];
  clock: () => Date;
  sleep: (ms: number) => Promise<void>;
  /**
   * Store the cancelled subscription Stripe returned, as reconcile stores any
   * other row: stamped newest when it is the current subscription, otherwise
   * older than the current one, so the brand's state still comes from it.
   */
  storeCancelledSubscription: (subscription: Stripe.Subscription) => Promise<void>;
}

interface CheckRow {
  stripe_subscription_id: string;
  outcome: TrialCardOutcome;
  cancelled_at: string | null;
  created_at: string;
}

const CHECK_COLUMNS = 'stripe_subscription_id, outcome, cancelled_at, created_at';

/** The stored code for a card fingerprint: HMAC-SHA256 with the 32-byte key, as 64 lower-case hex characters. */
export function trialCardHash(fingerprint: string, key: string): string {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(fingerprint, 'utf8').digest('hex');
}

async function readCheck(service: SupabaseClient, accountId: string, subscriptionId: string): Promise<CheckRow | null> {
  const { data, error } = await service
    .from('trial_card_checks')
    .select(CHECK_COLUMNS)
    .eq('stripe_subscription_id', subscriptionId)
    .eq('account_id', accountId)
    .maybeSingle<CheckRow>();
  if (error) throw new Error(`trial_card_checks lookup failed: ${error.message}`);
  return data;
}

/**
 * Insert one check row. 'conflict' is a unique violation (the primary key or
 * the one-trial-per-card index). created_at comes from the reconcile's clock,
 * the same clock finishRefusal measures a refusal's age with.
 */
async function insertCheck(
  input: TrialCardCheckInput,
  row: { card_hash: string; outcome: TrialCardOutcome },
): Promise<'inserted' | 'conflict'> {
  const { error } = await input.service.from('trial_card_checks').insert({
    stripe_subscription_id: input.current.id,
    account_id: input.accountId,
    card_hash: row.card_hash,
    outcome: row.outcome,
    created_at: input.clock().toISOString(),
  });
  if (!error) return 'inserted';
  if (error.code === '23505') return 'conflict';
  throw new Error(`trial_card_checks insert failed: ${error.message}`);
}

/**
 * Whether any brand has had its first trial on this card code. The one
 * deliberate cross-brand read: it asks only for a count, so nothing about the
 * other brand (not even which one) reaches this reconcile.
 */
async function cardHasFirstTrial(service: SupabaseClient, cardHash: string): Promise<boolean> {
  const { count, error } = await service
    .from('trial_card_checks')
    .select('stripe_subscription_id', { count: 'exact', head: true })
    .eq('card_hash', cardHash)
    .eq('outcome', 'first_trial');
  if (error) throw new Error(`trial_card_checks lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Whether this subscription's refusal is already in admin_audit (a retry after the email or the final mark failed). */
async function refusalAudited(service: SupabaseClient, accountId: string, subscriptionId: string): Promise<boolean> {
  const { data, error } = await service
    .from('admin_audit')
    .select('detail')
    .eq('action', 'trial_refused_repeat_card')
    .eq('target_account_id', accountId)
    .limit(50)
    .returns<Array<{ detail: { subscriptionId?: unknown } | null }>>();
  if (error) throw new Error(`admin_audit lookup failed: ${error.message}`);
  return (data ?? []).some((row) => row.detail?.subscriptionId === subscriptionId);
}

async function loadBrandName(service: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await service
    .from('accounts')
    .select('business_name')
    .eq('id', accountId)
    .maybeSingle<{ business_name: string | null }>();
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);
  return data?.business_name ?? null;
}

/**
 * The card fingerprint of the subscription's default payment method, or null
 * when it has none or the method is not a card (for example Link). Read from
 * Stripe now, never from a webhook payload. Needs PaymentMethods read on the
 * restricted key: without it Stripe refuses the expansion and this throws.
 */
async function cardFingerprint(stripe: Stripe, subscriptionId: string): Promise<string | null> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['default_payment_method'] });
  const method = subscription.default_payment_method;
  if (!method) return null;
  if (typeof method === 'string') {
    throw new TrialCardCheckError(`Stripe did not expand the default payment method of ${subscriptionId}`);
  }
  return method.card?.fingerprint ?? null;
}

interface Decision {
  outcome: TrialCardOutcome | null;
  /** This reconcile inserted the row, so it alone acts on it. */
  inserted: boolean;
}

/** Steps 4 and 5 of the spec for a subscription with no card to check. */
async function recordNoCard(input: TrialCardCheckInput): Promise<Decision> {
  const { service, accountId, current } = input;
  const result = await insertCheck(input, { card_hash: NO_CARD_HASH, outcome: 'no_card' });
  if (result === 'conflict') {
    const row = await readCheck(service, accountId, current.id);
    if (!row) throw new TrialCardCheckError(`trial_card_checks holds ${current.id} for another brand`);
    return { outcome: row.outcome, inserted: false };
  }
  logger.warn('trial started with no card to check', { accountId, subscriptionId: current.id });
  try {
    await alertTrialStartedWithoutCard({
      accountId,
      brandName: await loadBrandName(service, accountId),
      subscriptionId: current.id,
      customerId: input.customerId,
    });
  } catch (error) {
    // Not told yet: remove the row so the next reconcile records it again and
    // retries the email. If even that fails, the error below still fails the
    // reconcile, so the webhook alert fires.
    const { error: deleteError } = await service
      .from('trial_card_checks')
      .delete()
      .eq('stripe_subscription_id', current.id)
      .eq('account_id', accountId)
      .eq('outcome', 'no_card');
    if (deleteError) {
      logger.error('could not undo a no_card check after its operator email failed', undefined, {
        accountId,
        subscriptionId: current.id,
        reason: deleteError.message,
      });
    }
    throw error;
  }
  return { outcome: 'no_card', inserted: true };
}

/** Steps 1 and 2: decide the current trialing subscription, race-safe. */
async function decide(input: TrialCardCheckInput): Promise<Decision> {
  const { service, stripe, accountId, current } = input;

  // Already decided (a later event for the same trial): no Stripe call.
  const existing = await readCheck(service, accountId, current.id);
  if (existing) return { outcome: existing.outcome, inserted: false };

  // Only the trial a subscription started with is a free trial CheersAI gave.
  // A paid subscription moved into a trial later (a free month given in the
  // Stripe Dashboard, say) is the operator's choice: record nothing, refuse
  // nothing, and ask Stripe nothing about the card.
  if (!trialBeganAtCreation(current)) {
    logger.info('a trial that began after its subscription was created is not checked', {
      accountId,
      subscriptionId: current.id,
    });
    return { outcome: null, inserted: false };
  }

  const key = usableTrialCardHashKey();
  if (!key) throw new BillingNotConfiguredError(['TRIAL_CARD_HASH_KEY']);

  const fingerprint = await cardFingerprint(stripe, current.id);
  if (fingerprint === null) return recordNoCard(input);
  const cardHash = trialCardHash(fingerprint, key);

  // 1. Claim this card's one free trial.
  if ((await insertCheck(input, { card_hash: cardHash, outcome: 'first_trial' })) === 'inserted') {
    return { outcome: 'first_trial', inserted: true };
  }

  // 2. Either a parallel reconcile of this subscription decided first...
  const decided = await readCheck(service, accountId, current.id);
  if (decided) return { outcome: decided.outcome, inserted: false };

  // ...or another subscription holds this card's trial.
  if (current.created * 1000 < TRIAL_CARD_CHECK_STARTS_AT.getTime()) {
    logger.warn('a trial from before the card check shares a card with an earlier trial; recorded nothing, not refused', {
      accountId,
      subscriptionId: current.id,
    });
    return { outcome: null, inserted: false };
  }
  // Confirm the clash was the card before refusing: a primary-key clash with a
  // row that has since gone (a no_card row removed after its email failed)
  // must never read as "this card had a trial".
  if (!(await cardHasFirstTrial(service, cardHash))) {
    throw new TrialCardCheckError(`Could not decide the trial ${current.id}: its row changed while checking; this reconcile will be retried`);
  }
  if ((await insertCheck(input, { card_hash: cardHash, outcome: 'repeat_refused' })) === 'inserted') {
    logger.warn('trial refused: the card has already had a Cheers free trial', { accountId, subscriptionId: current.id });
    return { outcome: 'repeat_refused', inserted: true };
  }
  const raced = await readCheck(service, accountId, current.id);
  if (!raced) throw new TrialCardCheckError(`trial_card_checks holds ${current.id} for another brand`);
  return { outcome: raced.outcome, inserted: false };
}

/** Cancel a refused trial now, with nothing charged. "Already cancelled" counts as success. */
async function cancelTrial(stripe: Stripe, subscriptionId: string): Promise<Stripe.Subscription> {
  try {
    return await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
  } catch (error) {
    const again = await stripe.subscriptions.retrieve(subscriptionId);
    if (again.status === 'canceled') return again;
    throw error;
  }
}

/**
 * Claim the right to finish an unfinished refusal: at most one reconcile per
 * subscription per takeover window, through the database's atomic counter
 * (public.consume_rate_limit, one upsert on auth_rate_limits, whose rows the
 * retention job clears a day after they reset). The key holds the Stripe
 * subscription id only.
 */
async function claimTakeover(service: SupabaseClient, subscriptionId: string): Promise<boolean> {
  const { data, error } = await service.rpc('consume_rate_limit', {
    p_key: `trial_card_finish:${subscriptionId}`,
    p_limit: 1,
    p_window_seconds: REFUSAL_TAKEOVER_AFTER_MS / 1000,
  });
  if (error) throw new Error(`consume_rate_limit failed: ${error.message}`);
  const result = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown } | null;
  if (!result || typeof result.allowed !== 'boolean') throw new Error('consume_rate_limit returned no usable row');
  return result.allowed;
}

/** Wait for the reconcile that inserted this refusal to finish it. True once cancelled_at is set. */
async function waitForFinish(input: TrialCardCheckInput, subscriptionId: string): Promise<boolean> {
  for (let poll = 0; poll < REFUSAL_WAIT_POLLS; poll += 1) {
    await input.sleep(REFUSAL_POLL_MS);
    const row = await readCheck(input.service, input.accountId, subscriptionId);
    if (!row) throw new TrialCardCheckError(`trial_card_checks row for ${subscriptionId} disappeared while waiting`);
    if (row.cancelled_at) return true;
  }
  return false;
}

/**
 * Step 3 for one refused trial not yet marked cancelled. The reconcile that
 * inserted the refusal does it at once. Any other reconcile (a parallel event
 * for the same Checkout, or our own cancellation's customer.subscription
 * events) waits for that one to finish, so exactly one cancel is sent. A
 * refusal still unfinished after REFUSAL_TAKEOVER_AFTER_MS lost its reconcile
 * (Stripe or the database failed, or the function was killed), and the next
 * reconcile finishes it: that is the retry. Only one reconcile per window may
 * take over (claimTakeover), so retries arriving together do not each cancel,
 * email and audit.
 */
async function finishRefusal(input: TrialCardCheckInput, row: CheckRow, subscription: Stripe.Subscription, insertedByUs: boolean): Promise<void> {
  const { service, stripe, accountId, customerId, clock } = input;
  const subscriptionId = row.stripe_subscription_id;

  if (!insertedByUs) {
    const ageMs = clock().getTime() - Date.parse(row.created_at);
    if (ageMs < REFUSAL_TAKEOVER_AFTER_MS) {
      if (await waitForFinish(input, subscriptionId)) return;
      throw new TrialCardCheckError(
        `The refused trial ${subscriptionId} is still being cancelled by another reconcile; this one will be retried`,
      );
    }
    // Past the window, several reconciles can arrive at once (Stripe retries
    // the failed events of one Checkout together). Only one may finish it in
    // each window; the others wait for it like any parallel reconcile.
    if (!(await claimTakeover(service, subscriptionId))) {
      if (await waitForFinish(input, subscriptionId)) return;
      throw new TrialCardCheckError(
        `The refused trial ${subscriptionId} is being finished by another reconcile; this one will be retried`,
      );
    }
    logger.warn('finishing a refused trial that an earlier reconcile left unfinished', { accountId, subscriptionId, ageMs });
  }

  let cancelled: Stripe.Subscription;
  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    cancelled = subscription;
  } else if (subscription.status === 'trialing') {
    cancelled = await cancelTrial(stripe, subscriptionId);
  } else {
    // Only reachable if every retry failed until the trial ended: money may
    // have moved, so a person decides rather than the code.
    throw new TrialCardCheckError(
      `The refused trial ${subscriptionId} is now ${subscription.status} in Stripe; cancel or keep it by hand, then set trial_card_checks.cancelled_at`,
    );
  }
  if (cancelled.status !== 'canceled' && cancelled.status !== 'incomplete_expired') {
    throw new TrialCardCheckError(`Stripe did not cancel the refused trial ${subscriptionId} (status ${cancelled.status})`);
  }

  await input.storeCancelledSubscription(cancelled);

  // The email first (at least once: a failure leaves cancelled_at empty, so it
  // is sent again), then one audit row per refused subscription however many
  // times this runs.
  await alertTrialRefusedRepeatCard({ accountId, brandName: await loadBrandName(service, accountId), subscriptionId, customerId });

  if (!(await refusalAudited(service, accountId, subscriptionId))) {
    const { error: auditError } = await service.from('admin_audit').insert({
      actor_user_id: null,
      action: 'trial_refused_repeat_card',
      target_account_id: accountId,
      detail: { subscriptionId, customerId },
      result: 'success',
    });
    if (auditError) throw new Error(`admin_audit insert failed: ${auditError.message}`);
  }

  const { error: markError } = await service
    .from('trial_card_checks')
    .update({ cancelled_at: clock().toISOString() })
    .eq('stripe_subscription_id', subscriptionId)
    .eq('account_id', accountId)
    .is('cancelled_at', null);
  if (markError) throw new Error(`trial_card_checks update failed: ${markError.message}`);
  logger.info('refused trial cancelled in Stripe with nothing charged', { accountId, subscriptionId });
}

/**
 * The repeat-trial check for one brand's reconcile. Decides the current
 * subscription if it is a trial, then finishes every refusal of this brand
 * that is not yet marked cancelled. Throws on any Stripe or database error.
 */
export async function runTrialCardCheck(input: TrialCardCheckInput): Promise<TrialCardCheckResult> {
  const { service, accountId, current } = input;

  let decision: Decision;
  if (current.status === 'trialing') {
    decision = await decide(input);
  } else {
    // Not a trial now: read what was decided while it was, for the result only.
    const row = await readCheck(service, accountId, current.id);
    decision = { outcome: row?.outcome ?? null, inserted: false };
  }

  const { data, error } = await service
    .from('trial_card_checks')
    .select(CHECK_COLUMNS)
    .eq('account_id', accountId)
    .eq('outcome', 'repeat_refused')
    .is('cancelled_at', null)
    .returns<CheckRow[]>();
  if (error) throw new Error(`trial_card_checks lookup failed: ${error.message}`);

  for (const row of data ?? []) {
    const subscription = input.listed.find((listed) => listed.id === row.stripe_subscription_id);
    if (!subscription) {
      // Moved to another customer or deleted in Stripe: the code cannot tell
      // whether it still runs, so a person looks. The alert never blocks the
      // reconcile (at most one a day per brand).
      logger.error('a refused trial is not on the brand\'s Stripe customer any more; finish it by hand', undefined, {
        accountId,
        subscriptionId: row.stripe_subscription_id,
      });
      try {
        await alertRefusedTrialNotOnCustomer(
          service,
          { accountId, customerId: input.customerId, subscriptionId: row.stripe_subscription_id },
          input.clock(),
        );
      } catch (alertError) {
        logger.error('operator alert for a refused trial not on its customer could not be sent', alertError instanceof Error ? alertError : undefined, {
          accountId,
        });
      }
      continue;
    }
    const insertedByUs = decision.inserted && decision.outcome === 'repeat_refused' && row.stripe_subscription_id === current.id;
    await finishRefusal(input, row, subscription, insertedByUs);
  }

  return { outcome: decision.outcome, refused: decision.outcome === 'repeat_refused' };
}
