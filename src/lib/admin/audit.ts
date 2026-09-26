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
  | 'send_password_link'
  | 'set_brand_feature'
  | 'set_billing_override'
  | 'stripe_resync'
  | 'operator_stripe_webhook_alert'
  | 'offboard_brand'
  | 'export_brand_data'
  | 'purge_brand'
  | 'operator_publish_failure_alert'
  | 'team_invite'
  | 'team_remove'
  | 'team_role_change'
  | 'assign_member'
  | 'revoke_member'
  | 'grant_admin'
  | 'revoke_admin'
  | 'set_booking_key'
  | 'clear_booking_key';

interface AdminAuditParams {
  /** Null for system actions (crons), e.g. operator alerts. */
  actorUserId: string | null;
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
