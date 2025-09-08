import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    if (!userData?.tenant?.stripe_subscription_id) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 });
    }

    const stripe = getStripeClient();
    
    // Cancel subscription at period end
    await stripe.subscriptions.update(userData.tenant.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Update database
    await supabase
      .from("tenants")
      .update({ 
        subscription_status: "canceling"
      })
      .eq("id", userData.tenant.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Cancellation error:", error);
    return NextResponse.json(
      { error: "Failed to cancel subscription" },
      { status: 500 }
    );
  }
}
