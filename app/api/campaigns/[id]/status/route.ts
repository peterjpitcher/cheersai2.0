import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createRequestLogger } from '@/lib/observability/logger'
import { unauthorized, forbidden, notFound, ok, serverError } from '@/lib/http'
import { recomputeCampaignStatus } from '@/lib/campaigns/status'

interface Params {
  params: Promise<{ id: string }>
}

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: Params) {
  const reqLogger = createRequestLogger(request as unknown as Request)

  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    const { data: campaign, error: fetchError } = await supabase
      .from('campaigns')
      .select('tenant_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      throw fetchError
    }

    if (!campaign) {
      return notFound('Campaign not found', undefined, request)
    }

    const tenantId = userRow?.tenant_id
    if (tenantId && tenantId !== campaign.tenant_id) {
      return forbidden('Forbidden', undefined, request)
    }

    const result = await recomputeCampaignStatus(supabase, id)

    reqLogger.apiResponse('POST', `/api/campaigns/${id}/status`, 200, 0, {
      area: 'campaigns',
      op: 'status.recompute',
      status: 'ok',
      campaignId: id,
      changed: result.changed,
      value: result.status,
    })

    return ok(result, request)
  } catch (unknownError) {
    const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError))
    reqLogger.error('Failed to recompute campaign status', {
      area: 'campaigns',
      op: 'status.recompute',
      status: 'fail',
      error,
    })
    return serverError('Failed to recompute campaign status', { message: error.message }, request)
  }
}
