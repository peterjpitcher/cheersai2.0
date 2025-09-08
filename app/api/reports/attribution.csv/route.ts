import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unauthorized } from '@/lib/http'
import { getAttributionSummary } from '@/lib/reports'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  const result = await getAttributionSummary(u?.tenant_id, {})
  const rows = [['day','total','platform','count']]
  for (const [day, v] of Object.entries(result.byDay)) {
    for (const [pf, n] of Object.entries((v as any).byPlatform)) {
      rows.push([day, String((v as any).total), pf, String(n)])
    }
  }
  const csv = rows.map(r => r.join(',')).join('\n')
  return new NextResponse(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } })
}

