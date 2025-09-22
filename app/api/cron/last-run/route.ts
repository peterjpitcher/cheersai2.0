import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, badRequest, serverError } from '@/lib/http'

export const runtime = 'nodejs'

type QueueRow = {
  last_attempt_at: string | null
  scheduled_for: string | null
  updated_at: string | null
}

type HistoryRow = {
  created_at: string | null
}

const isTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const time = new Date(value).getTime()
  return Number.isFinite(time)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    const { data: u } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle<{ tenant_id: string | null }>()
    const tenantId = u?.tenant_id ?? null
    if (!tenantId) return badRequest('no_tenant', 'No tenant found for user', undefined, request)

    // Latest queue processing attempt
    const { data: q } = await supabase
      .from('publishing_queue')
      .select('last_attempt_at, scheduled_for, updated_at')
      .order('last_attempt_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .returns<QueueRow[]>()

    // Latest published history
    const { data: h } = await supabase
      .from('publishing_history')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .returns<HistoryRow[]>()

    const candidateTimestamps = [
      q?.[0]?.last_attempt_at,
      q?.[0]?.updated_at,
      q?.[0]?.scheduled_for,
      h?.[0]?.created_at,
    ].filter(isTimestamp)

    const lastRun = candidateTimestamps
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      .at(0) ?? null

    return ok({ lastRun }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    return serverError('Failed to fetch last cron run', { message: err.message }, request)
  }
}
