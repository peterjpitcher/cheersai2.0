import { createClient } from '@/lib/supabase/server'

export async function hasPermission(userId: string, tenantId: string, permission: string): Promise<boolean> {
  const supabase = await createClient()

  // Primary: explicit RBAC via user_roles → role_permissions
  const { data: rbacRows, error } = await supabase
    .from('user_roles')
    .select('role_id, roles:roles!inner(name, tenant_id, id), perms:role_permissions!inner(permission)')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)

  if (!error) {
    const rows = rbacRows || []
    if (rows.length === 0) {
      // Backward-compat: if no RBAC configured for this user/tenant, allow
      return true
    }
    const permitted = rows.some((r: any) => r.perms?.permission === permission)
    if (permitted) return true
  }

  // Fallback: coarse roles from user_tenants/users for operational continuity
  // Owner and Editor can create/approve/publish posts by default
  try {
    const { data: membership } = await supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const role = (membership?.role || '').toLowerCase()
    const postPerms = new Set([PERMISSIONS.POST_CREATE, PERMISSIONS.POST_APPROVE, PERMISSIONS.POST_PUBLISH])
    if ((role === 'owner' || role === 'editor') && postPerms.has(permission as any)) {
      return true
    }
  } catch {}

  return false
}

export const PERMISSIONS = {
  POST_CREATE: 'post.create',
  POST_APPROVE: 'post.approve',
  POST_PUBLISH: 'post.publish',
  CONNECTIONS_MANAGE: 'connections.manage',
  BILLING_MANAGE: 'billing.manage',
  ROLES_MANAGE: 'roles.manage',
} as const
