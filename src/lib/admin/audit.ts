/**
 * Global admin audit logger (multi-brand).
 *
 * Writes to public.admin_audit, which is brand-agnostic and survives brand
 * deletion (unlike audit_log, whose account_id is NOT NULL and cascades). Used
 * for super-admin actions such as creating brands and granting/revoking access.
 */
import { createServiceSupabaseClient } from '@/lib/supabase/service';

export type AdminAction =
  | 'create_brand'
  | 'archive_brand'
  | 'invite_user'
  | 'assign_member'
  | 'revoke_member'
  | 'grant_admin'
  | 'revoke_admin';

interface AdminAuditParams {
  actorUserId: string;
  action: AdminAction;
  targetUserId?: string | null;
  targetAccountId?: string | null;
  detail?: Record<string, unknown>;
  result?: 'success' | 'failure';
}

export async function logAdminEvent(params: AdminAuditParams): Promise<void> {
  const db = createServiceSupabaseClient();
  await db
    .from('admin_audit')
    .insert({
      actor_user_id: params.actorUserId,
      action: params.action,
      target_user_id: params.targetUserId ?? null,
      target_account_id: params.targetAccountId ?? null,
      detail: params.detail ?? null,
      result: params.result ?? 'success',
    })
    .throwOnError();
}
