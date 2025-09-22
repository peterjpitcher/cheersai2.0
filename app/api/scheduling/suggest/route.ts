import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unauthorized, badRequest, ok } from '@/lib/http'
import { suggestBestTimes } from '@/lib/scheduling/suggest'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const platform = request.nextUrl.searchParams.get('platform') || 'facebook'
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  const tenantId = u?.tenant_id
  if (!tenantId) return badRequest('no_tenant', 'Tenant not found')

  // Build heat map from clicks over last 90 days
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: links } = await supabase.from('short_links').select('id, platform').eq('tenant_id', tenantId)
  const heat: Record<string, number[]> = {}
  for (const l of links || []) {
    if (!heat[l.platform || 'unknown']) heat[l.platform || 'unknown'] = new Array(168).fill(0)
    const { data: clicks } = await supabase.from('short_clicks').select('ts').eq('link_id', l.id).gt('ts', since)
    for (const c of clicks || []) {
      const d = new Date(c.ts)
      const idx = (d.getDay() /* 0-6 Sun..Sat */) * 24 + d.getHours()
      heat[l.platform || 'unknown'][idx] += 1
    }
  }
  const top = suggestBestTimes(heat, platform)
  return ok({ platform, suggestions: top }, request)
}
