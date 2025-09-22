import { createClient } from '@/lib/supabase/server'

export async function getAttributionSummary(tenantId: string, params: { from?: string; to?: string }) {
  const supabase = await createClient()
  const { from, to } = params
  // Aggregate clicks by day and platform
  const { data: links } = await supabase
    .from('short_links')
    .select('id, platform')
    .eq('tenant_id', tenantId)

  const byDay: Record<string, { total: number; byPlatform: Record<string, number> }> = {}
  if (!links) return { byDay }

  // For performance, you’d do this server-side SQL; here we fetch in batches per link
  for (const l of links) {
    let clickQuery = supabase
      .from('short_clicks')
      .select('ts')
      .eq('link_id', l.id)
    if (from) clickQuery = clickQuery.gte('ts', from)
    if (to) clickQuery = clickQuery.lte('ts', to)
    const { data: clicks } = await clickQuery
    for (const c of clicks || []) {
      const day = new Date(c.ts).toISOString().slice(0, 10)
      byDay[day] ||= { total: 0, byPlatform: {} }
      byDay[day].total++
      const pf = l.platform || 'unknown'
      byDay[day].byPlatform[pf] = (byDay[day].byPlatform[pf] || 0) + 1
    }
  }
  return { byDay }
}
