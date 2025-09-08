import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const returnUrl = body?.returnUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000/settings/billing";

    const { data: userData } = await supabase
      .from("users")
      .select("tenant:tenants(id, stripe_customer_id)")
      .eq("id", user.id)
      .single();

    const tenant = userData?.tenant;
    if (!tenant) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    if (!tenant.stripe_customer_id) {
      return NextResponse.json({ error: "No Stripe customer associated with this tenant" }, { status: 400 });
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Create portal error:", error);
    return NextResponse.json({ error: "Failed to create billing portal" }, { status: 500 });
  }
}
