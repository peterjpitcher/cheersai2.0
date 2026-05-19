/**
 * Publish scheduler cron (04-02).
 * Runs every minute. Promotes publish_jobs from 'scheduled' to 'queued'
 * when their scheduled_at time has arrived, then dispatches each to QStash.
 */

import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { transitionStatus } from '@/lib/publishing/state-machine';
import { dispatchToQStash } from '@/lib/publishing/dispatch';
import { createLogger } from '@/lib/logging';

export const dynamic = 'force-dynamic';

const logger = createLogger('publish-scheduler');

interface ScheduledJobRow {
  id: string;
  content_item_id: string;
  idempotency_key: string;
}

function normaliseAuthHeader(value: string | null): string {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

async function handle(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const xCronSecret = request.headers.get('x-cron-secret')?.trim();
  const authHeader = normaliseAuthHeader(request.headers.get('authorization'));
  const headerSecret = xCronSecret || authHeader;
  const urlSecret = new URL(request.url).searchParams.get('secret')?.trim();

  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

      // Dispatch to QStash for processing
      await dispatchToQStash({
        jobId: job.id,
        deduplicationId: job.idempotency_key,
      });

      promoted++;
      logger.info('Promoted scheduled job', { jobId: job.id, contentItemId: job.content_item_id });
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
