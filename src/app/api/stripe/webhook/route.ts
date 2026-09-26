import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { env } from '@/env';
import { constructStripeEvent, missingBillingEnv } from '@/lib/billing/stripe';
import { processStripeEvent } from '@/lib/billing/webhook';
import { createLogger } from '@/lib/logging';
import { withCorrelationId } from '@/lib/logging/correlation';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Stripe webhook (spec §4.3). Stripe calls this server to server, so it is not
 * behind the app's login gate (that gate is the (app) layout; there is no
 * middleware). Trust comes only from the Stripe-Signature header, checked
 * against STRIPE_WEBHOOK_SECRET using the raw request body.
 *
 * 503 when billing is not configured (Stripe retries, nothing is lost), 400 for
 * a bad signature, 500 when the event could not be stored or processed (Stripe
 * retries), 200 once the event is stored and handled or deliberately ignored.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger('stripe-webhook');

function reply(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const missing = missingBillingEnv('webhook');
  if (missing.length) {
    logger.error('Stripe webhook called but billing is not configured', new Error('billing_not_configured'), { missing });
    return reply({ error: 'Billing is not set up yet.' }, 503);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    logger.warn('Rejected a Stripe webhook without a signature');
    return reply({ error: 'Missing Stripe-Signature header.' }, 400);
  }

  // The signature covers the exact bytes Stripe sent, so read the raw body.
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = constructStripeEvent(rawBody, signature, env.server.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    logger.warn('Rejected a Stripe webhook that failed signature verification', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return reply({ error: 'Invalid signature.' }, 400);
  }

  return withCorrelationId(async () => {
    let outcome;
    try {
      const service = createServiceSupabaseClient();
      outcome = await processStripeEvent(service, event);
    } catch (error) {
      logger.error('Stripe webhook failed unexpectedly', error instanceof Error ? error : undefined, {
        eventId: event.id,
        type: event.type,
      });
      return reply({ error: 'Processing failed; Stripe will retry.' }, 500);
    }
    return reply(outcome.body, outcome.status);
  });
}
