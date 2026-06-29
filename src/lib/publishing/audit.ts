/**
 * Publish pipeline audit logger (PUB-08).
 * Inserts structured audit events for every publish attempt, success, and failure.
 * Uses correlation IDs from the request context for end-to-end tracing.
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getCorrelationId } from '@/lib/logging/correlation';

interface AuditEventParams {
  accountId: string;
  operationType: 'publish_attempt' | 'publish_success' | 'publish_failure' | 'publish_retry' | 'state_transition' | 'content_scheduled';
  resourceType: 'publish_job' | 'content_item';
  resourceId: string;
  details?: Record<string, unknown>;
}

/**
 * Insert an audit log row for a publish pipeline event.
 * Automatically determines operation_status from the operationType
 * and includes the current correlation ID for tracing.
 */
export async function logPublishAuditEvent(params: AuditEventParams): Promise<void> {
  const db = createServiceSupabaseClient();

  await db.from('audit_log').insert({
    account_id: params.accountId,
    operation_type: params.operationType,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    operation_status: params.operationType.includes('failure') ? 'failure' : 'success',
    details: params.details ?? null,
    correlation_id: getCorrelationId(),
  }).throwOnError();
}
