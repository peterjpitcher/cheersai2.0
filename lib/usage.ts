import { createClient } from '@/lib/supabase/server'

type UsageQuotaRow = {
  tenant_id: string
  period_start: string
  tokens_used: number | null
  tokens_limit: number | null
  requests_used: number | null
}

export type BudgetCheck = { ok: boolean; code?: 'BUDGET_EXCEEDED' | 'OVER_LIMIT'; message?: string; usage?: UsageQuotaRow }

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
  const rows = (data ?? []) as UsageQuotaRow[]
  const first = rows[0]
  if (!first) return { ok: true }
  const nextTokens = Number(first.tokens_used || 0) + wantTokens
  if (nextTokens > Number(first.tokens_limit)) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Monthly AI budget exceeded', usage: first }
  }
  return { ok: true, usage: first }
}

export async function incrementUsage(tenantId: string, delta: { tokens?: number; requests?: number }) {
  const supabase = await createClient()
  const periodStart = new Date()
  periodStart.setUTCDate(1)
  periodStart.setUTCHours(0, 0, 0, 0)
  const periodIso = periodStart.toISOString()

  const tokenDelta = delta.tokens ?? 0
  const requestDelta = delta.requests ?? 1

  if (tokenDelta === 0 && requestDelta === 0) {
    return
  }

  const ensureRowExists = async () => {
    const { error } = await supabase
      .from('usage_quota')
      .upsert(
        [
          {
            tenant_id: tenantId,
            period_start: periodIso,
            tokens_used: 0,
            requests_used: 0,
          },
        ],
        { onConflict: 'tenant_id,period_start', ignoreDuplicates: true }
      )
    if (error && error.code !== '23505') {
      throw error
    }
  }

  await ensureRowExists()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: existing, error: fetchError } = await supabase
      .from('usage_quota')
      .select('tokens_used, requests_used')
      .eq('tenant_id', tenantId)
      .eq('period_start', periodIso)
      .maybeSingle()

    if (fetchError) {
      throw fetchError
    }

    if (!existing) {
      await ensureRowExists()
      continue
    }

    const currentTokens = Number(existing.tokens_used ?? 0)
    const currentRequests = Number(existing.requests_used ?? 0)
    const nextTokens = currentTokens + tokenDelta
    const nextRequests = currentRequests + requestDelta

    let updateBuilder = supabase
      .from('usage_quota')
      .update({
        tokens_used: nextTokens,
        requests_used: nextRequests,
      })
      .eq('tenant_id', tenantId)
      .eq('period_start', periodIso)

    updateBuilder = existing.tokens_used === null
      ? updateBuilder.is('tokens_used', null)
      : updateBuilder.eq('tokens_used', existing.tokens_used)

    updateBuilder = existing.requests_used === null
      ? updateBuilder.is('requests_used', null)
      : updateBuilder.eq('requests_used', existing.requests_used)

    const { data: updated, error: updateError } = await updateBuilder.select('tenant_id')

    if (updateError) {
      throw updateError
    }

    if (updated && updated.length > 0) {
      return
    }
  }

  throw new Error('Failed to increment usage quota after multiple attempts')
}
