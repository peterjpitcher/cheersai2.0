'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import type Stripe from 'stripe';
import { z } from 'zod';

import { env } from '@/env';
import { OwnerRequiredError, requireOwnerContext } from '@/lib/auth/roles';
import type { AuthContext } from '@/lib/auth/types';
import { isLiveSubscriptionStatus, type EntitlementState } from '@/lib/billing/entitlement';
import {
  BILLING_INTERVALS,
  SELF_SERVE_PLAN_IDS,
  stripePriceIdFor,
  TRIAL_DAYS,
  type BillingInterval,
  type SelfServePlanId,
} from '@/lib/billing/plans';
import { listCheersSubscriptions, reconcileBrandFromStripe } from '@/lib/billing/reconcile';
import {
  BILLING_NOT_CONFIGURED_MESSAGE,
  BillingNotConfiguredError,
  CHEERSAI_APP_TAG,
  getStripe,
  missingBillingEnv,
} from '@/lib/billing/stripe';
import { createLogger } from '@/lib/logging';

/**
 * Billing actions for the active brand (spec §4.3, decision D4: owners only).
 *
 * The browser only ever says which plan and billing period it wants, plus the
 * brand the page was rendered for; the Stripe price, customer and brand are
 * all decided here from the signed-in owner's active brand. The page's brand
 * is only a guard: if the active brand changed in another tab since the page
 * loaded, the action refuses instead of acting on a brand the owner is not
 * looking at. Every failure returns an error the Billing section shows, and
 * is logged.
 */

type ActionResult = { success?: boolean; error?: string };
export type BillingRedirectResult = ActionResult & { url?: string };

const logger = createLogger('billing');

const checkoutSchema = z
  .object({
    plan: z.enum(SELF_SERVE_PLAN_IDS),
    interval: z.enum(BILLING_INTERVALS),
    accountId: z.string(),
  })
  .strict();

/** Which brand the Billing section was rendered for. */
export interface BillingPageBrand {
  accountId: string;
}

const BRAND_SWITCHED = 'You switched brand in another tab. Refresh the page and try again.';

/** Null when the page's brand is still the active brand, else the message to show. */
function brandSwitched(ctx: AuthContext, pageAccountId: unknown): string | null {
  return typeof pageAccountId === 'string' && pageAccountId === ctx.accountId ? null : BRAND_SWITCHED;
}

const TRY_AGAIN = 'Please try again, or contact Cheers support if it keeps happening.';

async function ownerContext(): Promise<AuthContext | { error: string }> {
  try {
    return await requireOwnerContext();
  } catch (error) {
    if (error instanceof OwnerRequiredError) return { error: error.message };
    throw error;
  }
}

function settingsUrl(query?: string): string {
  const url = new URL('/settings', env.client.NEXT_PUBLIC_SITE_URL);
  if (query) url.search = query;
  return url.toString();
}

interface BrandBillingRow {
  archived_at: string | null;
  billing_override: 'comped' | 'suspended' | null;
  business_name: string | null;
  email: string | null;
}

async function loadBrand(ctx: AuthContext): Promise<BrandBillingRow | null> {
  const { data, error } = await ctx.supabase
    .from('accounts')
    .select('archived_at, billing_override, business_name, email')
    .eq('id', ctx.accountId)
    .maybeSingle<BrandBillingRow>();
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);
  return data;
}

/** A reason this brand must not start Checkout, or null when it may. */
function checkoutRefusal(brand: BrandBillingRow | null): string | null {
  if (!brand) return 'Brand not found.';
  if (brand.archived_at) return 'This brand has been closed.';
  if (brand.billing_override === 'comped') return 'This brand is included free of charge, so there is nothing to pay.';
  if (brand.billing_override === 'suspended') return 'This brand is on hold. Contact Cheers support.';
  return null;
}

async function findCustomerId(ctx: AuthContext): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('account_id', ctx.accountId)
    .maybeSingle<{ stripe_customer_id: string }>();
  if (error) throw new Error(`billing_customers lookup failed: ${error.message}`);
  return data?.stripe_customer_id ?? null;
}

/**
 * The email of the brand's longest-standing owner, used only when the brand
 * has no contact email. Deterministic per brand, so any owner's retry builds
 * the same customer.
 */
async function firstOwnerEmail(ctx: AuthContext): Promise<string | null> {
  const { data: owner, error } = await ctx.supabase
    .from('account_members')
    .select('user_id')
    .eq('account_id', ctx.accountId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .order('user_id', { ascending: true })
    .limit(1)
    .maybeSingle<{ user_id: string }>();
  if (error) throw new Error(`account_members lookup failed: ${error.message}`);
  if (!owner) return null;
  const { data: snapshot, error: snapshotError } = await ctx.supabase
    .from('user_auth_snapshot')
    .select('email')
    .eq('user_id', owner.user_id)
    .maybeSingle<{ email: string | null }>();
  if (snapshotError) throw new Error(`user_auth_snapshot lookup failed: ${snapshotError.message}`);
  return snapshot?.email?.trim() || null;
}

/**
 * Customer details from brand data only: the brand's name and contact email
 * (accounts.email), else its first owner's email. Never the clicking user's
 * email, which may be a super-admin's, and never anything that differs
 * between owners, because the idempotency key is per brand and Stripe rejects
 * a reused key with different parameters.
 */
async function customerParams(ctx: AuthContext, brand: BrandBillingRow): Promise<Stripe.CustomerCreateParams> {
  const email = brand.email?.trim() || (await firstOwnerEmail(ctx)) || undefined;
  return {
    name: brand.business_name ?? undefined,
    email,
    metadata: { app: CHEERSAI_APP_TAG, account_id: ctx.accountId },
  };
}

/**
 * The brand's Stripe customer, created and stored (before any use) if it has
 * none. The idempotency key is per brand, so a retry after a failed save gets
 * the same Stripe customer back instead of a duplicate.
 */
async function getOrCreateCustomer(ctx: AuthContext, stripe: Stripe, brand: BrandBillingRow): Promise<string> {
  const existing = await findCustomerId(ctx);
  if (existing) return existing;

  const customer = await stripe.customers.create(await customerParams(ctx, brand), {
    idempotencyKey: `cheersai-customer-${ctx.accountId}`,
  });

  const { error } = await ctx.supabase
    .from('billing_customers')
    .insert({ account_id: ctx.accountId, stripe_customer_id: customer.id });
  if (!error) return customer.id;

  if (error.code === '23505') {
    // Saved by a parallel request first; use whatever is stored.
    const stored = await findCustomerId(ctx);
    if (stored) return stored;
  }
  throw new Error(`billing_customers insert failed: ${error.message}`);
}

/** Expire any unfinished CheersAI Checkout for this customer so only one can complete. */
async function expireOpenCheckouts(stripe: Stripe, customerId: string): Promise<void> {
  const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 });
  for (const session of open.data) {
    if (session.metadata?.app === CHEERSAI_APP_TAG) await stripe.checkout.sessions.expire(session.id);
  }
}

/** Start Stripe Checkout for the active brand. Returns the Checkout URL to send the owner to. */
export async function startCheckout(
  input: { plan: SelfServePlanId; interval: BillingInterval } & BillingPageBrand,
): Promise<BillingRedirectResult> {
  const ctx = await ownerContext();
  if ('error' in ctx) return ctx;
  const switched = brandSwitched(ctx, input?.accountId);
  if (switched) return { error: switched };

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { error: 'Choose a plan and a billing period.' };
  const { plan, interval } = parsed.data;

  if (missingBillingEnv('checkout').length) return { error: BILLING_NOT_CONFIGURED_MESSAGE };
  const priceId = stripePriceIdFor(plan, interval);
  if (!priceId) return { error: BILLING_NOT_CONFIGURED_MESSAGE };

  try {
    const brand = await loadBrand(ctx);
    const refusal = checkoutRefusal(brand);
    if (refusal || !brand) return { error: refusal ?? 'Brand not found.' };

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(ctx, stripe, brand);

    const previous = await listCheersSubscriptions(stripe, customerId);
    if (previous.some((subscription) => isLiveSubscriptionStatus(subscription.status))) {
      return { error: 'This brand already has a subscription. Use Manage billing to change or restart it.' };
    }
    await expireOpenCheckouts(stripe, customerId);

    // One free trial per brand: a brand that has subscribed before pays from day one.
    const trial = previous.length === 0;
    const metadata = { app: CHEERSAI_APP_TAG, account_id: ctx.accountId, plan, interval };
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: ctx.accountId,
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_collection: 'always',
        subscription_data: {
          ...(trial ? { trial_period_days: TRIAL_DAYS } : {}),
          metadata,
        },
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        billing_address_collection: 'required',
        customer_update: { name: 'auto', address: 'auto' },
        metadata,
        success_url: settingsUrl('checkout=success'),
        cancel_url: settingsUrl('checkout=cancelled'),
      },
      { idempotencyKey: `cheersai-checkout-${ctx.accountId}-${randomUUID()}` },
    );
    if (!session.url) throw new Error(`Checkout Session ${session.id} has no URL`);

    logger.info('checkout started', { accountId: ctx.accountId, plan, interval, trial, sessionId: session.id });
    return { success: true, url: session.url };
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) return { error: BILLING_NOT_CONFIGURED_MESSAGE };
    logger.error('could not start checkout', error instanceof Error ? error : undefined, { accountId: ctx.accountId, plan, interval });
    return { error: `Could not start checkout. ${TRY_AGAIN}` };
  }
}

/** Open the Stripe customer portal (change plan, card, invoices, cancel) for the active brand. */
export async function openBillingPortal(input: BillingPageBrand): Promise<BillingRedirectResult> {
  const ctx = await ownerContext();
  if ('error' in ctx) return ctx;
  const switched = brandSwitched(ctx, input?.accountId);
  if (switched) return { error: switched };
  if (missingBillingEnv('portal').length) return { error: BILLING_NOT_CONFIGURED_MESSAGE };

  try {
    const brand = await loadBrand(ctx);
    if (!brand) return { error: 'Brand not found.' };
    if (brand.archived_at) return { error: 'This brand has been closed.' };

    const customerId = await findCustomerId(ctx);
    if (!customerId) return { error: 'This brand has no billing account yet. Choose a plan first.' };

    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      // Always CheersAI's own configuration: the account default belongs to another app.
      configuration: env.server.STRIPE_PORTAL_CONFIGURATION_ID,
      return_url: settingsUrl(),
    });
    return { success: true, url: session.url };
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) return { error: BILLING_NOT_CONFIGURED_MESSAGE };
    logger.error('could not open the billing portal', error instanceof Error ? error : undefined, { accountId: ctx.accountId });
    return { error: `Could not open billing. ${TRY_AGAIN}` };
  }
}

/** "Check again" after Checkout: read the brand's subscription from Stripe now. */
export async function checkBillingAgain(input: BillingPageBrand): Promise<ActionResult & { state?: EntitlementState }> {
  const ctx = await ownerContext();
  if ('error' in ctx) return ctx;
  const switched = brandSwitched(ctx, input?.accountId);
  if (switched) return { error: switched };
  if (missingBillingEnv('reconcile').length) return { error: BILLING_NOT_CONFIGURED_MESSAGE };

  try {
    const result = await reconcileBrandFromStripe(ctx.accountId, { service: ctx.supabase });
    revalidatePath('/settings');
    return { success: true, state: result.state };
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) return { error: BILLING_NOT_CONFIGURED_MESSAGE };
    logger.error('check again: reconcile failed', error instanceof Error ? error : undefined, { accountId: ctx.accountId });
    return { error: 'Could not check with Stripe just now. Please try again in a minute.' };
  }
}
