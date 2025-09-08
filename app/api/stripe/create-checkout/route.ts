import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { getTierById } from "@/lib/stripe/config";
import { z } from 'zod'
import { createCheckoutSchema } from '@/lib/validation/schemas'
import { unauthorized, badRequest, notFound, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
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

    if (!userData?.tenant) {
      return notFound('No tenant found', undefined, request)
    }

    const stripe = getStripeClient();
    
    // Create or retrieve Stripe customer
    let customerId = userData.tenant.stripe_customer_id;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          tenant_id: userData.tenant.id,
          user_id: user.id,
        },
      });
      
      customerId = customer.id;
      
      // Save customer ID to database
      await supabase
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", userData.tenant.id);
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
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: resolvedPriceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/settings/billing?success=true`,
      cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/settings/billing`,
      metadata: {
        tenant_id: userData.tenant.id,
        user_id: user.id,
      },
    });

    return ok({ url: session.url || null, sessionId: session.id }, request)
  } catch (error) {
    console.error("Checkout error:", error);
    return serverError('Failed to create checkout session', undefined, request)
  }
}
