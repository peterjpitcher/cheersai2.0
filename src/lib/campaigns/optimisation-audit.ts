/**
 * Audit trail for optimiser changes that reach live Meta ads.
 *
 * Every row carries the acting user's id, so each replacement ad (and each decision to switch one
 * on) can be traced to a person. Mirrors the attempt / success / failure pattern of
 * logPublishAuditEvent in src/lib/publishing/audit.ts.
 */

import { getCorrelationId } from '@/lib/logging/correlation';
import type { createServiceSupabaseClient } from '@/lib/supabase/service';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

export type OptimisationAuditOperation =
  | 'optimisation_rewrite_apply_attempt'
  | 'optimisation_rewrite_applied'
  | 'optimisation_rewrite_apply_failed'
  | 'optimisation_replacement_activate_attempt'
  | 'optimisation_replacement_activated'
  | 'optimisation_replacement_activate_failed';

export interface OptimisationAuditEvent {
  accountId: string;
  userId: string;
  operationType: OptimisationAuditOperation;
  /** meta_optimisation_actions.id */
  actionId: string;
  details?: Record<string, unknown>;
}

/**
 * Inserts one audit row. Throws when the row cannot be written, so an attempt row can gate the
 * Meta call: no record of who, no change.
 */
export async function logOptimisationAuditEvent(
  supabase: SupabaseClientLike,
  event: OptimisationAuditEvent,
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    account_id: event.accountId,
    user_id: event.userId,
    operation_type: event.operationType,
    resource_type: 'meta_optimisation_action',
    resource_id: event.actionId,
    operation_status: event.operationType.endsWith('_failed') ? 'failure' : 'success',
    details: event.details ?? null,
    correlation_id: getCorrelationId(),
  });

  if (error) {
    throw new Error(`Could not record who made this change, so nothing was changed: ${error.message}`);
  }
}

/** For outcome rows written after the change: the attempt row already names the user. */
export async function logOptimisationAuditEventBestEffort(
  supabase: SupabaseClientLike,
  event: OptimisationAuditEvent,
): Promise<void> {
  try {
    await logOptimisationAuditEvent(supabase, event);
  } catch (error) {
    console.error(`[optimisation-audit] failed to record ${event.operationType}`, error);
  }
}
