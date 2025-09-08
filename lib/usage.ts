import { createClient } from '@/lib/supabase/server'

export type BudgetCheck = { ok: boolean; code?: 'BUDGET_EXCEEDED'|'OVER_LIMIT'; message?: string; usage?: any }

export async function checkTenantBudget(tenantId: string, wantTokens = 0): Promise<BudgetCheck> {
  const supabase = await createClient()
  const periodStart = new Date(); periodStart.setDate(1) // month window
  const { data } = await supabase
    .from('usage_quota')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('period_start', periodStart.toISOString())
    .order('period_start', { ascending: false })
    .limit(1)
  const row = data?.[0]
  if (!row) return { ok: true }
  const nextTokens = Number(row.tokens_used || 0) + wantTokens
  if (nextTokens > Number(row.tokens_limit)) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Monthly AI budget exceeded', usage: row }
  }
  return { ok: true, usage: row }
}

export async function incrementUsage(tenantId: string, delta: { tokens?: number; requests?: number }) {
  const supabase = await createClient()
  const periodStart = new Date(); periodStart.setDate(1)
  // Upsert naive: relies on PostgREST upsert
  await supabase.from('usage_quota').upsert({
    tenant_id: tenantId,
    period_start: new Date(periodStart.getFullYear(), periodStart.getMonth(), 1).toISOString(),
    tokens_used: delta.tokens || 0,
    requests_used: delta.requests || 1,
  }, { onConflict: 'tenant_id,period_start' })
}

