import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { unauthorized, notFound, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
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
    await stripe.subscriptions.update(tenant.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Update database
    await supabase
      .from("tenants")
      .update({ 
        subscription_status: "canceling"
      })
      .eq("id", tenant.id);

    return ok({ success: true }, request)
  } catch (error) {
    console.error("Cancellation error:", error);
    return serverError('Failed to cancel subscription', undefined, request)
  }
}
