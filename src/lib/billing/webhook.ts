import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

import { reconcileBrandFromStripe, type ReconcileResult } from '@/lib/billing/reconcile';
import { CHEERSAI_APP_TAG, stripeId } from '@/lib/billing/stripe';
import { createLogger } from '@/lib/logging';
import { alertStripeWebhookFailure } from '@/lib/notifications/operator-alerts';

/**
 * Stripe webhook processing (spec §4.3), after the signature has been verified.
 *
 * 1. Record the event id in stripe_events (unique). A redelivery of an event
 *    already processed is a no-op; a redelivery of one that failed runs again.
 * 2. Ignore anything not about a CheersAI customer (the Stripe account is
 *    shared with the management app). Ignored events are still recorded and
 *    marked processed.
 * 3. Reconcile the brand by reading its current state from Stripe, never from
 *    the event payload, so the order events arrive in does not matter.
 * 4. Mark the event processed, or store the error and answer 500 so Stripe
 *    retries. A 2xx is only ever returned once the event row is stored.
 */

const logger = createLogger('stripe-webhook');

/** Events that can change a brand's subscription state. */
export const RECONCILE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
]);

export interface WebhookOutcome {
  status: 200 | 500;
  body: Record<string, unknown>;
}

export interface WebhookDeps {
  reconcile?: (accountId: string) => Promise<ReconcileResult>;
  now?: () => Date;
}

interface EventObjectShape {
  customer?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
}

async function recordEvent(service: SupabaseClient, event: Stripe.Event): Promise<'new' | 'retry' | 'done' | 'error'> {
  const { error } = await service.from('stripe_events').insert({ id: event.id, type: event.type });
  if (!error) return 'new';
  if (error.code !== '23505') {
    logger.error('could not record Stripe event', undefined, { eventId: event.id, type: event.type, reason: error.message });
    return 'error';
  }
  const { data, error: lookupError } = await service
    .from('stripe_events')
    .select('processed_at')
    .eq('id', event.id)
    .maybeSingle<{ processed_at: string | null }>();
  if (lookupError) {
    logger.error('could not read a recorded Stripe event', undefined, { eventId: event.id, reason: lookupError.message });
    return 'error';
  }
  return data?.processed_at ? 'done' : 'retry';
}

async function markEvent(
  service: SupabaseClient,
  eventId: string,
  values: { processed_at: string | null; error: string | null },
): Promise<boolean> {
  const { error } = await service.from('stripe_events').update(values).eq('id', eventId);
  if (error) {
    logger.error('could not update a Stripe event row', undefined, { eventId, reason: error.message });
    return false;
  }
  return true;
}

async function accountForCustomer(service: SupabaseClient, customerId: string): Promise<string | null> {
  const { data, error } = await service
    .from('billing_customers')
    .select('account_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle<{ account_id: string }>();
  if (error) throw new Error(`billing_customers lookup failed: ${error.message}`);
  return data?.account_id ?? null;
}

export async function processStripeEvent(
  service: SupabaseClient,
  event: Stripe.Event,
  deps: WebhookDeps = {},
): Promise<WebhookOutcome> {
  const now = deps.now ?? (() => new Date());
  const reconcile = deps.reconcile ?? ((accountId: string) => reconcileBrandFromStripe(accountId, { service }));

  const recorded = await recordEvent(service, event);
  if (recorded === 'error') return { status: 500, body: { error: 'Could not record the event.' } };
  if (recorded === 'done') return { status: 200, body: { received: true, duplicate: true } };

  const object = (event.data?.object ?? {}) as EventObjectShape;
  const customerId = stripeId(object.customer ?? null);

  let accountId: string | null = null;
  try {
    accountId = customerId ? await accountForCustomer(service, customerId) : null;
  } catch (error) {
    return fail(service, event, error);
  }

  if (!accountId) {
    // Not a CheersAI customer: most likely the management app's. Recorded and done.
    const taggedForUs = object.metadata?.app === CHEERSAI_APP_TAG;
    if (taggedForUs) {
      // Should never happen (customers are stored before any Checkout starts).
      logger.error('CheersAI-tagged Stripe event for an unknown customer', undefined, {
        eventId: event.id,
        type: event.type,
        customerId,
      });
    }
    const marked = await markEvent(service, event.id, {
      processed_at: now().toISOString(),
      error: taggedForUs ? 'ignored: CheersAI metadata but no billing customer row' : null,
    });
    return marked ? { status: 200, body: { received: true, ignored: true } } : { status: 500, body: { error: 'Could not record the event.' } };
  }

  if (!RECONCILE_EVENT_TYPES.has(event.type)) {
    const marked = await markEvent(service, event.id, { processed_at: now().toISOString(), error: null });
    return marked ? { status: 200, body: { received: true, handled: false } } : { status: 500, body: { error: 'Could not record the event.' } };
  }

  if (event.type === 'checkout.session.completed' && object.client_reference_id && object.client_reference_id !== accountId) {
    // The stored customer decides the brand; a mismatch means something is wrong upstream.
    logger.error('Checkout Session brand does not match its customer', undefined, {
      eventId: event.id,
      accountId,
      clientReferenceId: object.client_reference_id,
    });
  }

  let result: ReconcileResult;
  try {
    result = await reconcile(accountId);
  } catch (error) {
    return fail(service, event, error, accountId);
  }

  const marked = await markEvent(service, event.id, { processed_at: now().toISOString(), error: null });
  if (!marked) return { status: 500, body: { error: 'Could not record the event.' } };

  logger.info('Stripe event reconciled', {
    eventId: event.id,
    type: event.type,
    accountId,
    outcome: result.outcome,
    status: result.status,
    state: result.state,
    released: result.released,
  });
  return { status: 200, body: { received: true, outcome: result.outcome } };
}

async function fail(service: SupabaseClient, event: Stripe.Event, error: unknown, accountId?: string): Promise<WebhookOutcome> {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Stripe event processing failed; Stripe will retry', error instanceof Error ? error : undefined, {
    eventId: event.id,
    type: event.type,
    accountId,
  });
  await markEvent(service, event.id, { processed_at: null, error: message.slice(0, 1000) });
  try {
    await alertStripeWebhookFailure(service, { eventId: event.id, eventType: event.type, message, accountId: accountId ?? null });
  } catch (alertError) {
    logger.error('operator alert for a failed Stripe event could not be sent', alertError instanceof Error ? alertError : undefined, {
      eventId: event.id,
    });
  }
  return { status: 500, body: { error: 'Processing failed; Stripe will retry.' } };
}
