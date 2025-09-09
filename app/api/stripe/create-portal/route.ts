import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { z } from 'zod'
import { unauthorized, badRequest, notFound, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const parsed = await request.json().catch(() => ({}))
    const schema = z.object({ returnUrl: z.string().url().optional() })
    const res = schema.safeParse(parsed)
    const returnUrl = (res.success && res.data.returnUrl) || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000/settings/billing";

    const { data: userData } = await supabase
      .from("users")
      .select("tenant:tenants(id, stripe_customer_id)")
      .eq("id", user.id)
      .single();

    const tenant = Array.isArray((userData as any)?.tenant) ? (userData as any).tenant[0] : (userData as any)?.tenant;
    if (!tenant) {
      return notFound('No tenant found', undefined, request)
    }

    if (!tenant.stripe_customer_id) {
      return badRequest('no_customer', 'No Stripe customer associated with this tenant', undefined, request)
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: returnUrl,
    });

    return ok({ url: session.url }, request)
  } catch (error) {
    console.error("Create portal error:", error);
    return serverError('Failed to create billing portal', undefined, request)
  }
}
