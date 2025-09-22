import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getStripeClient } from "@/lib/stripe/client";
import { createServiceRoleClient } from "@/lib/server-only";
import { getTierByPriceId } from "@/lib/stripe/config";
import Stripe from "stripe";
import { badRequest, serverError, ok } from '@/lib/http'
import { safeLog } from '@/lib/scrub'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = (await headers()).get("stripe-signature");
  
  if (!signature) {
    return badRequest('missing_signature', 'No signature')
  }

  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    safeLog("STRIPE_WEBHOOK_SECRET not set", {});
    return serverError('Webhook secret not configured')
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    safeLog("Webhook signature verification failed:", error);
    return badRequest('invalid_signature', 'Invalid signature')
  }

  const supabase = await createServiceRoleClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenant_id;
        
        if (!tenantId) {
          safeLog("No tenant_id in session metadata", {});
          break;
        }

        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = subscription.items.data[0].price.id;
        const tier = getTierByPriceId(priceId);
        
        if (!tier) {
          safeLog("Unknown price ID:", { priceId });
          break;
        }

        // Update tenant subscription
        await supabase
          .from("tenants")
          .update({
            subscription_tier: tier.id,
            subscription_status: "active",
            stripe_subscription_id: subscription.id,
            trial_ends_at: null, // Clear trial
          })
          .eq("id", tenantId);
        
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        
        // Find tenant by Stripe customer ID
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id || null

        if (!customerId) {
          safeLog('Subscription missing customer ID', { subscriptionId: subscription.id })
          break
        }

        const { data: tenant } = await supabase
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();
        
        if (!tenant) {
          safeLog("Tenant not found for customer:", { customer: subscription.customer });
          break;
        }

        const priceId = subscription.items.data[0].price.id;
        const tier = getTierByPriceId(priceId);
        
        if (!tier) {
          safeLog("Unknown price ID:", { priceId });
          break;
        }

        // Update subscription tier and status
        await supabase
          .from("tenants")
          .update({
            subscription_tier: tier.id,
            subscription_status: subscription.cancel_at_period_end ? "canceling" : "active",
          })
          .eq("id", tenant.id);
        
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        
        // Find tenant by Stripe customer ID
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id || null

        if (!customerId) {
          safeLog('Subscription missing customer ID', { subscriptionId: subscription.id })
          break
        }

        const { data: tenant } = await supabase
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();
        
        if (!tenant) {
          safeLog("Tenant not found for customer:", { customer: subscription.customer });
          break;
        }

        // Downgrade to free tier
        await supabase
          .from("tenants")
          .update({
            subscription_tier: "free",
            subscription_status: "inactive",
            stripe_subscription_id: null,
          })
          .eq("id", tenant.id);
        
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        
        // Find tenant by Stripe customer ID
        const customerId = typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id || null

        if (!customerId) {
          safeLog('Invoice missing customer ID', { invoiceId: invoice.id })
          break
        }

        const { data: tenant } = await supabase
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();
        
        if (!tenant) {
          safeLog("Tenant not found for customer:", { customer: invoice.customer });
          break;
        }

        // Mark subscription as past due
        await supabase
          .from("tenants")
          .update({
            subscription_status: "past_due",
          })
          .eq("id", tenant.id);
        
        break;
      }
    }

    return ok({ received: true })
  } catch (error) {
    safeLog("Webhook processing error:", error);
    return serverError('Webhook processing failed')
  }
}
