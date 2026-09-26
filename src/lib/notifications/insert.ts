/**
 * Type-safe notification insert helper.
 * Live `public.notifications` columns (information_schema, checked 2026-09-26):
 *   id, account_id (NOT NULL), category, message (NOT NULL, no default), read_at,
 *   metadata, created_at, urgency, title, body, resource_type, resource_id (uuid),
 *   dismissed_at
 *
 * `message` is what the planner feed and notification history display, and every
 * other writer fills it with a one-line headline, so it gets the title.
 * `title` repeats the headline; `body` is the detailed message.
 * `resource_type` + `resource_id` enable idempotency dedup and linking.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyUrgency } from './routing';

interface InsertNotificationParams {
  supabase: SupabaseClient; // service-role client
  accountId: string;
  category: string;
  title: string;
  body?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
}

/**
 * `duplicate` means the same alert was already recorded; `failed` means nothing
 * was recorded and the caller must treat it as a failure, never as a duplicate.
 */
export type InsertNotificationResult =
  | { status: 'inserted' }
  | { status: 'duplicate' }
  | { status: 'failed'; error: string };

/**
 * Insert a notification with correct schema columns and idempotency check.
 *
 * Idempotency: if resourceType and resourceId are provided, checks for an
 * existing notification with the same category + resource within the last 24h.
 */
export async function insertNotification(
  params: InsertNotificationParams,
): Promise<InsertNotificationResult> {
  const { supabase, accountId, category, title, body, resourceType, resourceId } = params;
  const urgency = classifyUrgency(category);

  // Idempotency: check if notification with same category + resource already exists in last 24h
  if (resourceType && resourceId) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing, error: lookupError } = await supabase
      .from('notifications')
      .select('id')
      .eq('account_id', accountId)
      .eq('category', category)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .gte('created_at', cutoff)
      .limit(1);

    if (lookupError) {
      // Without the lookup a duplicate cannot be told from a new alert.
      return { status: 'failed', error: `Duplicate check failed: ${lookupError.message}` };
    }

    if (existing && existing.length > 0) {
      return { status: 'duplicate' };
    }
  }

  const { error } = await supabase.from('notifications').insert({
    account_id: accountId,
    urgency,
    title,
    message: title,
    body: body ?? null,
    category,
    resource_type: resourceType ?? null,
    resource_id: resourceId ?? null,
  });

  if (error) {
    return { status: 'failed', error: error.message };
  }

  return { status: 'inserted' };
}
