import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { unauthorized, notFound, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { withRetry } from '@/lib/reliability/retry'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get user's tenant and subscription
    const { data: userData } = await supabase
      .from("users")
      .select(`
        tenant:tenants (
          id,
          stripe_subscription_id
        )
      `)
      .eq("id", user.id)
      .single();

    const tenant = Array.isArray((userData as any)?.tenant) ? (userData as any).tenant[0] : (userData as any)?.tenant;
    if (!tenant?.stripe_subscription_id) {
      return notFound('No active subscription found', undefined, request)
    }

    const stripe = getStripeClient();
    
    // Cancel subscription at period end
    await withRetry(
      () =>
        stripe.subscriptions.update(tenant.stripe_subscription_id, {
          cancel_at_period_end: true,
        }),
      { maxAttempts: 3, initialDelay: 500, maxDelay: 2000 }
    )

    // Update database
    await supabase
      .from("tenants")
      .update({ 
        subscription_status: "canceling"
      })
      .eq("id", tenant.id);

    reqLogger.info('Stripe subscription cancellation scheduled', {
      area: 'billing',
      op: 'subscription.cancel',
      status: 'ok',
      tenantId: tenant.id,
      meta: { subscriptionId: tenant.stripe_subscription_id },
    })
    return ok({ success: true }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Stripe subscription cancellation failed', {
      area: 'billing',
      op: 'subscription.cancel',
      status: 'fail',
      error: err,
    })
    logger.error('Stripe cancellation error', {
      area: 'billing',
      op: 'subscription.cancel',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to cancel subscription', undefined, request)
  }
}
