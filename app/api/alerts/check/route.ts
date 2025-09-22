import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/server-only'
import { logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.ALERTS_SECRET ? `Bearer ${process.env.ALERTS_SECRET}` : ''
  if (expected && auth !== expected) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const supabase = await createServiceRoleClient()
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  // Publish success rate last 30 minutes
  const { data: ph } = await supabase
    .from('publishing_history')
    .select('status, created_at')
    .gte('created_at', since)

  const total = (ph || []).length
  const published = (ph || []).filter(r => r.status === 'published').length
  const successRate = total > 0 ? (published / total) : 1

  // Oldest pending queue item
  const { data: pq } = await supabase
    .from('publishing_queue')
    .select('scheduled_for, status')
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(1)
  const oldestPendingAgeMin = pq?.[0]?.scheduled_for
    ? Math.max(0, Math.round((Date.now() - new Date(pq[0].scheduled_for as string).getTime()) / 60000))
    : 0

  // Token expired spikes (approx via error_message contains token phrases)
  const { data: tokenErrors } = await supabase
    .from('publishing_history')
    .select('id')
    .gte('created_at', since)
    .ilike('error_message', '%token%')
  const tokenExpiredCount = (tokenErrors || []).length

  const ok = successRate >= 0.95 && oldestPendingAgeMin <= 15
  logger.event(ok ? 'info' : 'warn', {
    area: 'alerts', op: 'check', status: ok ? 'ok' : 'fail',
    msg: 'alerts check',
    meta: { successRate, oldestPendingAgeMin, tokenExpiredCount }
  })
  return NextResponse.json({ ok, successRate, oldestPendingAgeMin, tokenExpiredCount })
}
