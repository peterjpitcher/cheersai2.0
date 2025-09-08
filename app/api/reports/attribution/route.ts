import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unauthorized, ok } from '@/lib/http'
import { getAttributionSummary } from '@/lib/reports'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  const result = await getAttributionSummary(u?.tenant_id, {})
  return ok(result, request)
}

