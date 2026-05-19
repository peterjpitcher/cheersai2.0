import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * DEPRECATED: Publishing is now handled by QStash webhook at /api/webhooks/qstash-publish.
 * Scheduled job promotion is at /api/cron/publish-scheduler.
 * This route is kept as a tombstone to prevent 404s from old cron configurations.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    deprecated: true,
    message: 'Use /api/cron/publish-scheduler for scheduled jobs and /api/webhooks/qstash-publish for QStash delivery.',
  }, { status: 410 });
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({
    deprecated: true,
    message: 'Use /api/cron/publish-scheduler for scheduled jobs and /api/webhooks/qstash-publish for QStash delivery.',
  }, { status: 410 });
}
