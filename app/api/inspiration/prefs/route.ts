import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, badRequest, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')

  const { data } = await supabase
    .from('user_prefs')
    .select('show_sports, show_alcohol')
    .eq('user_id', user.id)
    .maybeSingle()

  return ok({
    show_sports: data?.show_sports ?? true,
    show_alcohol: data?.show_alcohol ?? true,
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required', undefined, request)

  const body = await request.json().catch(() => ({}))
  const show_sports = typeof body?.show_sports === 'boolean' ? body.show_sports : undefined
  const show_alcohol = typeof body?.show_alcohol === 'boolean' ? body.show_alcohol : undefined
  if (typeof show_sports === 'undefined' && typeof show_alcohol === 'undefined') {
    return badRequest('no_changes', 'No preference updates supplied', undefined, request)
  }

  const payload: { user_id: string; show_sports?: boolean; show_alcohol?: boolean } = { user_id: user.id }
  if (typeof show_sports !== 'undefined') payload.show_sports = show_sports
  if (typeof show_alcohol !== 'undefined') payload.show_alcohol = show_alcohol

  const { error } = await supabase
    .from('user_prefs')
    .upsert(payload, { onConflict: 'user_id' })

  if (error) return serverError('Failed to update inspiration preferences', { message: error.message }, request)
  return ok({ success: true }, request)
}
