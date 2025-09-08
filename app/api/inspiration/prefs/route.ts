import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const { data } = await supabase
    .from('user_prefs')
    .select('show_sports, show_alcohol')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    show_sports: data?.show_sports ?? true,
    show_alcohol: data?.show_alcohol ?? true,
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const body = await request.json().catch(() => ({}))
  const show_sports = typeof body?.show_sports === 'boolean' ? body.show_sports : undefined
  const show_alcohol = typeof body?.show_alcohol === 'boolean' ? body.show_alcohol : undefined
  if (typeof show_sports === 'undefined' && typeof show_alcohol === 'undefined') {
    return NextResponse.json({ ok: false, error: 'no_changes' }, { status: 400 })
  }

  const payload: any = { user_id: user.id }
  if (typeof show_sports !== 'undefined') payload.show_sports = show_sports
  if (typeof show_alcohol !== 'undefined') payload.show_alcohol = show_alcohol

  const { error } = await supabase
    .from('user_prefs')
    .upsert(payload, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

