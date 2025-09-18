import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { getTierById } from "@/lib/stripe/config";
import { z } from 'zod'
import { createCheckoutSchema } from '@/lib/validation/schemas'
import { unauthorized, badRequest, notFound, ok, serverError } from '@/lib/http'
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

    const raw = await request.json();
    const parsed = z.object(createCheckoutSchema.shape).extend({
      tier: z.string().optional(),
      successUrl: z.string().url().optional(),
      cancelUrl: z.string().url().optional(),
    }).safeParse(raw)
    const { priceId, tier, successUrl, cancelUrl } = parsed.success ? (parsed.data as any) : (raw || {})

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select(`
        tenant:tenants (
          id,
          name,
          stripe_customer_id
        )
      `)
      .eq("id", user.id)
      .single();

    const tenant = Array.isArray((userData as any)?.tenant) ? (userData as any).tenant[0] : (userData as any)?.tenant;
    if (!tenant) {
      return notFound('No tenant found', undefined, request)
    }

    const stripe = getStripeClient();
    
    // Create or retrieve Stripe customer
    let customerId = tenant.stripe_customer_id as string | null;
    
    if (!customerId) {
      const customer = await withRetry(
        () =>
          stripe.customers.create({
            email: user.email,
            metadata: {
              tenant_id: tenant.id,
              user_id: user.id,
            },
          }),
        { maxAttempts: 3, initialDelay: 500, maxDelay: 2000 }
      )
      
      customerId = customer.id;
      
      // Save customer ID to database
      await supabase
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenant.id);
    }

    // Determine price from either explicit priceId or tier mapping
    let resolvedPriceId = priceId as string | undefined;
    if (!resolvedPriceId && tier) {
      const mapped = getTierById(tier);
      resolvedPriceId = mapped?.priceIdMonthly || mapped?.priceId || '';
    }
    if (!resolvedPriceId) {
      return badRequest('missing_price', 'Missing price for selected tier', undefined, request)
    }

    // Create checkout session
    const session = await withRetry(
      () =>
        stripe.checkout.sessions.create({
          customer: customerId!,
          payment_method_types: ["card"],
          line_items: [
            {
              price: resolvedPriceId!,
              quantity: 1,
            },
          ],
          mode: "subscription",
          success_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/settings/billing?success=true`,
          cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/settings/billing`,
          metadata: {
            tenant_id: tenant.id,
            user_id: user.id,
          },
        }),
      { maxAttempts: 3, initialDelay: 500, maxDelay: 2000 }
    )

    reqLogger.info('Stripe checkout session created', {
      area: 'billing',
      op: 'checkout.create',
      status: 'ok',
      tenantId: tenant.id,
      meta: { sessionId: session.id, priceId: resolvedPriceId, tier },
    })

    return ok({ url: session.url || null, sessionId: session.id }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Stripe checkout session creation failed', {
      area: 'billing',
      op: 'checkout.create',
      status: 'fail',
      error: err,
    })
    logger.error('Stripe checkout error', {
      area: 'billing',
      op: 'checkout.create',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to create checkout session', undefined, request)
  }
}
