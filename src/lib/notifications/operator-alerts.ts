import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { sendEmail } from '@/lib/email/resend';

/**
 * Operator alerts: tell us (not the customer) when a brand keeps failing to
 * publish, so a paying customer's broken publishing is noticed even if they
 * have turned failure emails off or are not reading them.
 *
 * Deduplicated through admin_audit (operator-only, never shown to customers):
 * at most one alert per brand per rolling 24 hours.
 */
export const REPEATED_FAILURE_THRESHOLD = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const ALERT_ACTION = 'operator_publish_failure_alert';

export interface OperatorAlertResult {
  alerted: string[];
  skipped: string[];
}

export async function alertRepeatedPublishFailures(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<OperatorAlertResult> {
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();

  const { data: failedJobs, error: jobsError } = await service
    .from('publish_jobs')
    .select('content_item_id')
    .eq('status', 'failed')
    .gt('updated_at', cutoff)
    .returns<Array<{ content_item_id: string }>>();
  if (jobsError) throw new Error(`publish_jobs lookup failed: ${jobsError.message}`);

  const contentIds = [...new Set((failedJobs ?? []).map((job) => job.content_item_id))];
  if (contentIds.length === 0) return { alerted: [], skipped: [] };

  const { data: items, error: itemsError } = await service
    .from('content_items')
    .select('id, account_id')
    .in('id', contentIds)
    .returns<Array<{ id: string; account_id: string }>>();
  if (itemsError) throw new Error(`content_items lookup failed: ${itemsError.message}`);

  const accountByContent = new Map((items ?? []).map((item) => [item.id, item.account_id]));
  const failuresByAccount = new Map<string, number>();
  for (const job of failedJobs ?? []) {
    const accountId = accountByContent.get(job.content_item_id);
    if (accountId) failuresByAccount.set(accountId, (failuresByAccount.get(accountId) ?? 0) + 1);
  }

  const result: OperatorAlertResult = { alerted: [], skipped: [] };
  for (const [accountId, failures] of failuresByAccount) {
    if (failures < REPEATED_FAILURE_THRESHOLD) continue;

    const { data: recentAlert, error: auditError } = await service
      .from('admin_audit')
      .select('id')
      .eq('action', ALERT_ACTION)
      .eq('target_account_id', accountId)
      .gt('created_at', cutoff)
      .limit(1)
      .maybeSingle();
    if (auditError) throw new Error(`admin_audit lookup failed: ${auditError.message}`);
    if (recentAlert) {
      result.skipped.push(accountId);
      continue;
    }

    const { data: account } = await service
      .from('accounts')
      .select('business_name')
      .eq('id', accountId)
      .maybeSingle<{ business_name: string | null }>();
    const brandName = account?.business_name ?? accountId;

    const to = env.server.OPERATOR_ALERT_EMAIL;
    if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set; cannot send operator alert.');

    await sendEmail({
      to,
      subject: `[Cheers operator] ${brandName}: ${failures} failed posts in 24 hours`,
      html: `
<p>${escapeHtml(brandName)} has had <strong>${failures}</strong> posts fail to publish in the last 24 hours.</p>
<p>Brand id: ${escapeHtml(accountId)}</p>
<p>Check the brand's connections and planner. You will not get another alert for this brand for 24 hours.</p>
`.trim(),
      required: true,
    });

    await logAdminEvent({
      actorUserId: null,
      action: ALERT_ACTION,
      targetAccountId: accountId,
      detail: { failures, windowHours: 24 },
    });
    result.alerted.push(accountId);
  }

  return result;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
