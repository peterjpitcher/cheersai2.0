import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { priceId } = await request.json();
    
    if (!priceId) {
      return NextResponse.json({ error: "Price ID required" }, { status: 400 });
    }

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
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
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

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?canceled=true`,
      metadata: {
        tenant_id: userData.tenant.id,
        user_id: user.id,
      },
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}