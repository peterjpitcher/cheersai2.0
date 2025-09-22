import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCampaignLimit, checkPostLimit, checkMediaLimit } from "@/lib/subscription/limits";
import { z } from 'zod'
import { unauthorized, notFound, badRequest, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const parsed = z.object({ type: z.enum(['campaign','post','media']), count: z.number().min(1).optional() }).safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid type', parsed.error.format(), request)
    }
    const { type, count = 1 } = parsed.data
    
    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    
    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }

    let result: unknown;
    
    switch (type) {
      case "campaign":
        result = await checkCampaignLimit(userData.tenant_id);
        break;
      case "post":
        result = await checkPostLimit(userData.tenant_id, count);
        break;
      case "media":
        result = await checkMediaLimit(userData.tenant_id);
        break;
      default:
        return badRequest('invalid_type', 'Invalid type', undefined, request)
    }

    reqLogger.info('Limit check completed', {
      area: 'subscription',
      op: `check.${type}`,
      status: 'ok',
      tenantId: userData.tenant_id,
      meta: { count },
    })
    return ok(result, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Limit check failed', {
      area: 'subscription',
      op: 'check',
      status: 'fail',
      error: err,
    })
    logger.error('Limit check error', {
      area: 'subscription',
      op: 'check',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to check limits', { message: err.message }, request)
  }
}
