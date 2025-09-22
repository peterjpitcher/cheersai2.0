import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe/client";
import { z } from 'zod'
import { unauthorized, badRequest, notFound, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { withRetry } from '@/lib/reliability/retry'
import type { Database } from '@/lib/types/database'

export const runtime = 'nodejs'

type TenantPortalInfo = Pick<Database['public']['Tables']['tenants']['Row'], 'id' | 'stripe_customer_id'>

type UserTenantPortal = {
  tenant: TenantPortalInfo | TenantPortalInfo[] | null
}

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
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
      .single<UserTenantPortal>();

    const tenant = Array.isArray(userData?.tenant) ? userData?.tenant[0] : userData?.tenant
    if (!tenant) {
      return notFound('No tenant found', undefined, request)
    }

    if (!tenant.stripe_customer_id) {
      return badRequest('no_customer', 'No Stripe customer associated with this tenant', undefined, request)
    }
    const customerId = tenant.stripe_customer_id as string
    const tenantId = tenant.id
    if (!tenantId) {
      return notFound('Tenant not found', undefined, request)
    }

    const stripe = getStripeClient();
    const session = await withRetry(
      () =>
        stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: returnUrl,
        }),
      { maxAttempts: 3, initialDelay: 500, maxDelay: 2000 }
    )

    reqLogger.info('Stripe billing portal session created', {
      area: 'billing',
      op: 'portal.create',
      status: 'ok',
      tenantId,
      meta: { returnUrl },
    })

    return ok({ url: session.url }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Stripe billing portal session creation failed', {
      area: 'billing',
      op: 'portal.create',
      status: 'fail',
      error: err,
    })
    logger.error('Stripe portal error', {
      area: 'billing',
      op: 'portal.create',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to create billing portal', undefined, request)
  }
}
