import { createClient } from '@/lib/supabase/server'

export const PERMISSIONS = {
  POST_CREATE: 'post.create',
  POST_APPROVE: 'post.approve',
  POST_PUBLISH: 'post.publish',
  CONNECTIONS_MANAGE: 'connections.manage',
  BILLING_MANAGE: 'billing.manage',
  ROLES_MANAGE: 'roles.manage',
} as const

type PermissionValue = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export async function hasPermission(userId: string, tenantId: string, permission: PermissionValue): Promise<boolean> {
  const supabase = await createClient()

  // Primary: explicit RBAC via user_roles → role_permissions
  const { data: rbacRows, error } = await supabase
    .from('user_roles')
    .select('role_id, roles:roles!inner(name, tenant_id, id), perms:role_permissions!inner(permission)')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)

  if (!error && Array.isArray(rbacRows)) {
    if (rbacRows.length === 0) {
      // Backward-compat: if no RBAC configured for this user/tenant, allow
      return true
    }
    const permitted = rbacRows.some(row => {
      const permsField = row?.perms
      if (Array.isArray(permsField)) {
        return permsField.some(p => {
          if (p && typeof p === 'object' && 'permission' in p) {
            const permValue = (p as Record<string, unknown>).permission
            return typeof permValue === 'string' && permValue === permission
          }
          return false
        })
      }
      if (permsField && typeof permsField === 'object' && 'permission' in permsField) {
        const permValue = (permsField as Record<string, unknown>).permission
        return typeof permValue === 'string' && permValue === permission
      }
      return false
    })
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
    const postPerms = new Set<PermissionValue>([
      PERMISSIONS.POST_CREATE,
      PERMISSIONS.POST_APPROVE,
      PERMISSIONS.POST_PUBLISH,
    ])
    if ((role === 'owner' || role === 'editor') && postPerms.has(permission)) {
      return true
    }
  } catch {}

  return false
}
