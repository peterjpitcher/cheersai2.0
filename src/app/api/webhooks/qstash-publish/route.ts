/**
 * QStash publish webhook handler (PUB-04).
 * Receives signed messages from QStash, verifies the signature,
 * and delegates to processPublishJob within a correlation context.
 * Returns 500 on failure so QStash retries at 5m/15m/45m.
 */

import { NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash/client';
import { processPublishJob } from '@/lib/publishing/handler';
import { withCorrelationId } from '@/lib/logging/correlation';
import { createLogger } from '@/lib/logging';

export const dynamic = 'force-dynamic';

const logger = createLogger('publish-webhook');

export async function POST(request: Request): Promise<NextResponse> {
  // Clone before verify -- verifyQStashSignature consumes request.text()
  const cloned = request.clone();
  const isValid = await verifyQStashSignature(request);
  if (!isValid) {
    logger.warn('Invalid QStash signature rejected');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = await cloned.json();
  const { jobId } = body as { jobId: string };
  if (!jobId) {
    logger.warn('Missing jobId in QStash payload');
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  return withCorrelationId(async () => {
    const startMs = Date.now();
    logger.info('Processing publish job', { jobId });

    try {
      const result = await processPublishJob(jobId);
      const durationMs = Date.now() - startMs;
      logger.info('Publish job complete', { jobId, ...result, durationMs });
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      const durationMs = Date.now() - startMs;
      logger.error('Publish job failed', error as Error, { jobId, durationMs });
      // Return 500 so QStash retries
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
  });
}
