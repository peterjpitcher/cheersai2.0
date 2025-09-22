import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unauthorized } from '@/lib/http'
import { getAttributionSummary } from '@/lib/reports'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  const tenantId = u?.tenant_id
  if (!tenantId) return unauthorized('Tenant missing')
  const result = await getAttributionSummary(tenantId, {})
  const rows = [['day','total','platform','count']]
  for (const [day, stats] of Object.entries(result.byDay)) {
    for (const [platform, count] of Object.entries(stats.byPlatform)) {
      rows.push([day, String(stats.total), platform, String(count)])
    }
  }
  const csv = rows.map(r => r.join(',')).join('\n')
  return new NextResponse(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } })
}
