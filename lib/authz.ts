import { createClient } from '@/lib/supabase/server'

export async function hasPermission(userId: string, tenantId: string, permission: string): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('user_roles')
    .select('role_id, roles:roles!inner(name, tenant_id, id), perms:role_permissions!inner(permission)')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
  if (error) return false
  const rows = data || []
  if (rows.length === 0) {
    // Backward-compat: if no roles configured, allow operation
    return true
  }
  return rows.some((r: any) => r.perms?.permission === permission)
}

export const PERMISSIONS = {
  POST_CREATE: 'post.create',
  POST_APPROVE: 'post.approve',
  POST_PUBLISH: 'post.publish',
  CONNECTIONS_MANAGE: 'connections.manage',
  BILLING_MANAGE: 'billing.manage',
  ROLES_MANAGE: 'roles.manage',
} as const
