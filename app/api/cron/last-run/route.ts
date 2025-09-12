import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle()
    const tenantId = u?.tenant_id as string | undefined
    if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

    // Latest queue processing attempt
    const { data: q } = await supabase
      .from('publishing_queue')
      .select('last_attempt_at, scheduled_for, updated_at')
      .order('last_attempt_at', { ascending: false, nullsFirst: false })
      .limit(1)

    // Latest published history
    const { data: h } = await supabase
      .from('publishing_history')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)

    const lastAttempt = q?.[0]?.last_attempt_at || q?.[0]?.updated_at || null
    const lastHistory = h?.[0]?.created_at || null
    const lastRun = [lastAttempt, lastHistory].filter(Boolean).sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime())[0] || null

    return NextResponse.json({ lastRun })
  } catch (e) {
    return NextResponse.json({ lastRun: null })
  }
}

