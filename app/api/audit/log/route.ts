import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { entityType, entityId, action, meta } = body || {}
  if (!entityType || !entityId || !action) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 })
  // Resolve tenant id for user
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  await supabase.from('audit_log').insert({ tenant_id: u?.tenant_id || null, user_id: user.id, entity_type: entityType, entity_id: String(entityId), action, meta })
  return NextResponse.json({ ok: true })
}

