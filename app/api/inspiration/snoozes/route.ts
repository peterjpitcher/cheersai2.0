import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const body = await request.json().catch(() => ({}))
  const event_id = body?.event_id as string | undefined
  const date = body?.date as string | undefined // YYYY-MM-DD
  if (!event_id || !date) return NextResponse.json({ ok: false, error: 'missing_params' }, { status: 400 })

  const { error } = await supabase.from('inspiration_snoozes').upsert({ user_id: user.id, event_id, date })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const url = request.nextUrl
  const event_id = url.searchParams.get('event_id')
  const date = url.searchParams.get('date')
  if (!event_id || !date) return NextResponse.json({ ok: false, error: 'missing_params' }, { status: 400 })

  const { error } = await supabase
    .from('inspiration_snoozes')
    .delete()
    .eq('user_id', user.id)
    .eq('event_id', event_id)
    .eq('date', date)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

