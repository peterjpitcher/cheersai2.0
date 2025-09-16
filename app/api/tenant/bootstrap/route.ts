import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const logger = createRequestLogger(request as unknown as Request)
  logger.apiRequest('GET', '/api/tenant/bootstrap', { area: 'auth', op: 'bootstrap-tenant' })
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      logger.warn('bootstrap-tenant: unauthorized')
      return unauthorized('Authentication required', undefined, request)
    }

    // Fetch users.tenant_id without forcing single-row 406
    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    let tenantId: string | null = userRow?.tenant_id ?? null
    if (!tenantId) {
      // Adopt the earliest/lowest-role membership if present
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id, role, created_at')
        .eq('user_id', user.id)
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (membership?.tenant_id) {
        tenantId = membership.tenant_id
        try {
          await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id)
          logger.info('bootstrap-tenant: users.tenant_id hydrated from membership', { tenantId: tenantId || undefined })
        } catch (e) {
          logger.warn('bootstrap-tenant: users.tenant_id update failed', { error: e instanceof Error ? e : new Error(String(e)) })
        }
      }
    }

    if (!tenantId) {
      logger.info('bootstrap-tenant: no tenant found for user')
      return notFound('no_tenant', undefined, request)
    }

    logger.apiResponse('GET', '/api/tenant/bootstrap', 200, 0, { area: 'auth', op: 'bootstrap-tenant', status: 'ok', tenantId: tenantId || undefined })
    return ok({ tenantId }, request)
  } catch (error) {
    logger.error('bootstrap-tenant: unhandled error', { error: error instanceof Error ? error : new Error(String(error)) })
    return serverError('Unexpected error', undefined, request)
  }
}
