import { createClient } from '@/lib/supabase/server'

export async function auditLog(opts: { tenantId?: string; userId?: string; entityType: string; entityId: string; action: string; meta?: Record<string, unknown> }) {
  const supabase = await createClient()
  await supabase.from('audit_log').insert({
    tenant_id: opts.tenantId || null,
    user_id: opts.userId || null,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    action: opts.action,
    meta: opts.meta || null,
  })
}

export async function addPostRevision(opts: { postId: string; userId?: string; diff: Record<string, unknown>; version?: number }) {
  const supabase = await createClient()
  // Determine next version
  const { data: rows } = await supabase
    .from('post_revisions')
    .select('version')
    .eq('post_id', opts.postId)
    .order('version', { ascending: false })
    .limit(1)
  const nextVersion = (rows?.[0]?.version || 0) + 1
  await supabase.from('post_revisions').insert({
    post_id: opts.postId,
    user_id: opts.userId || null,
    version: opts.version ?? nextVersion,
    diff: opts.diff as any,
  })
}

