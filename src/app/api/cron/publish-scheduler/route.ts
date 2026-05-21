/**
 * Publish scheduler cron (04-02).
 * Runs every minute. Promotes publish_jobs from 'scheduled' to 'queued'
 * when their scheduled_at time has arrived, then dispatches each to QStash.
 */

import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { transitionStatus } from '@/lib/publishing/state-machine';
import { dispatchToQStash } from '@/lib/publishing/dispatch';
import { verifyCronAuth } from '@/lib/security/cron-auth';
import { createLogger } from '@/lib/logging';

export const dynamic = 'force-dynamic';

const logger = createLogger('publish-scheduler');

interface ScheduledJobRow {
  id: string;
  content_item_id: string;
  idempotency_key: string;
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  const db = createServiceSupabaseClient();

  // Query jobs that are scheduled and whose scheduled_at has arrived
  const { data: jobs, error: queryError } = await db
    .from('publish_jobs')
    .select('id, content_item_id, idempotency_key')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .returns<ScheduledJobRow[]>();

  if (queryError) {
    logger.error('Failed to query scheduled jobs', new Error(queryError.message));
    return NextResponse.json({ error: 'Query failed', message: queryError.message }, { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    logger.info('No scheduled jobs to promote');
    return NextResponse.json({ promoted: 0 });
  }

  let promoted = 0;

  for (const job of jobs) {
    try {
      // Transition publish_jobs: scheduled -> queued
      await transitionStatus(db, 'publish_jobs', job.id, 'scheduled', 'queued');

      // Transition content_items: scheduled -> queued
      await transitionStatus(db, 'content_items', job.content_item_id, 'scheduled', 'queued');

      // Dispatch to QStash — if this fails, revert statuses
      try {
        await dispatchToQStash({
          jobId: job.id,
          deduplicationId: job.idempotency_key,
        });

        promoted++;
        logger.info('Promoted scheduled job', { jobId: job.id, contentItemId: job.content_item_id });
      } catch (dispatchErr) {
        // QStash dispatch failed — revert to scheduled so next cron run retries.
        // Use direct DB updates because queued → scheduled is not a valid state-machine transition.
        await db.from('publish_jobs')
          .update({ status: 'scheduled', updated_at: new Date().toISOString() })
          .eq('id', job.id);
        await db.from('content_items')
          .update({ status: 'scheduled', updated_at: new Date().toISOString() })
          .eq('id', job.content_item_id);

        logger.error(
          'QStash dispatch failed, reverted to scheduled',
          dispatchErr instanceof Error ? dispatchErr : new Error(String(dispatchErr)),
          { jobId: job.id },
        );
      }
    } catch (err) {
      // Isolate per-job errors so one failure doesn't abort the batch
      logger.error(
        'Failed to promote job',
        err instanceof Error ? err : new Error(String(err)),
        { jobId: job.id },
      );
    }
  }

  logger.info('Scheduler run complete', { promoted, total: jobs.length });
  return NextResponse.json({ promoted });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
