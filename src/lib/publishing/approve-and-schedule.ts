/**
 * Approve-and-schedule flow (04-02).
 * Runs preflight checks, transitions content through the state machine,
 * creates publish jobs, and dispatches to QStash for immediate or deferred execution.
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPublishReadinessIssues } from '@/lib/publishing/preflight';
import { enqueuePublishJob } from '@/lib/publishing/queue';
import { dispatchToQStash } from '@/lib/publishing/dispatch';
import { transitionStatus } from '@/lib/publishing/state-machine';
import { logPublishAuditEvent } from '@/lib/publishing/audit';
import type { Platform, ContentStatus } from '@/types/content';

interface ApproveResult {
  success: boolean;
  issues?: Array<{ code: string; message: string }>;
  jobIds?: string[];
}

interface ApproveParams {
  contentItemId: string;
  accountId: string;
  platforms: Platform[];
  scheduledAt: Date | null; // null = publish now
  placement: 'feed' | 'story';
}

/** Threshold in ms -- scheduledAt within 60s of now counts as "immediate". */
const IMMEDIATE_THRESHOLD_MS = 60_000;

/**
 * Approve content and schedule it for publishing.
 *
 * 1. Runs preflight checks for every target platform. If any fail, returns issues.
 * 2. Transitions content_items from current status to 'approved'.
 * 3. For each platform: creates a publish_job via enqueuePublishJob.
 *    - Immediate: transitions to 'queued' and dispatches to QStash now.
 *    - Future: transitions to 'scheduled'. The cron scheduler picks it up.
 * 4. Logs an audit event for the state transition.
 */
export async function approveAndSchedule({
  contentItemId,
  accountId,
  platforms,
  scheduledAt,
  placement,
}: ApproveParams): Promise<ApproveResult> {
  const db = createServiceSupabaseClient();

  // 1. Run preflight checks for every platform
  const allIssues: Array<{ code: string; message: string }> = [];
  for (const platform of platforms) {
    const issues = await getPublishReadinessIssues({
      supabase: db,
      accountId,
      contentId: contentItemId,
      platform,
      placement,
    });
    allIssues.push(...issues);
  }

  if (allIssues.length > 0) {
    return { success: false, issues: allIssues };
  }

  // 2. Load current content status and transition to 'approved'
  const { data: contentRow, error: loadError } = await db
    .from('content_items')
    .select('status')
    .eq('id', contentItemId)
    .single();

  if (loadError || !contentRow) {
    throw new Error(`Failed to load content item ${contentItemId}: ${loadError?.message ?? 'not found'}`);
  }

  const currentStatus = contentRow.status as ContentStatus;
  await transitionStatus(db, 'content_items', contentItemId, currentStatus, 'approved');

  // 3. Determine immediate vs future scheduling
  const now = Date.now();
  const effectiveScheduledAt = scheduledAt && scheduledAt.getTime() > now
    ? scheduledAt
    : new Date();
  const isImmediate = !scheduledAt || (effectiveScheduledAt.getTime() - now) < IMMEDIATE_THRESHOLD_MS;

  // 4. Create publish jobs and dispatch
  const jobIds: string[] = [];

  for (const platform of platforms) {
    const jobId = await enqueuePublishJob({
      contentItemId,
      accountId,
      platform,
      scheduledAt: effectiveScheduledAt,
    });
    jobIds.push(jobId);

    if (isImmediate) {
      await transitionStatus(db, 'content_items', contentItemId, 'approved', 'queued');
      const deduplicationId = `${contentItemId}:${platform}:${effectiveScheduledAt.toISOString()}`;
      await dispatchToQStash({ jobId, deduplicationId });
    } else {
      await transitionStatus(db, 'content_items', contentItemId, 'approved', 'scheduled');
    }
  }

  // 5. Log audit event
  await logPublishAuditEvent({
    accountId,
    operationType: 'state_transition',
    resourceType: 'content_item',
    resourceId: contentItemId,
    details: { platforms, scheduledAt: scheduledAt?.toISOString() ?? null },
  });

  return { success: true, jobIds };
}
