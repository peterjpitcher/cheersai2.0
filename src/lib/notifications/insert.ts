/**
 * Type-safe notification insert helper.
 * Uses the correct notifications table schema columns:
 *   id, account_id, urgency, title, body, category, resource_type, resource_id,
 *   read_at, dismissed_at, created_at
 *
 * Note: The schema does NOT have `message` or `metadata` columns.
 * `title` is the short notification headline; `body` is the detailed message.
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
 * Insert a notification with correct schema columns and idempotency check.
 * Returns { inserted: true } if new, { inserted: false } if duplicate.
 *
 * Idempotency: if resourceType and resourceId are provided, checks for an
 * existing notification with the same category + resource within the last 24h.
 */
export async function insertNotification(
  params: InsertNotificationParams,
): Promise<{ inserted: boolean; error?: string }> {
  const { supabase, accountId, category, title, body, resourceType, resourceId } = params;
  const urgency = classifyUrgency(category);

  // Idempotency: check if notification with same category + resource already exists in last 24h
  if (resourceType && resourceId) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('account_id', accountId)
      .eq('category', category)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .gte('created_at', cutoff)
      .limit(1);

    if (existing && existing.length > 0) {
      return { inserted: false };
    }
  }

  const { error } = await supabase.from('notifications').insert({
    account_id: accountId,
    urgency,
    title,
    body: body ?? null,
    category,
    resource_type: resourceType ?? null,
    resource_id: resourceId ?? null,
  });

  if (error) {
    return { inserted: false, error: error.message };
  }

  return { inserted: true };
}
