/**
 * QStash dispatch wrapper (PUB-03).
 * Sends publish jobs to QStash with deduplication and retry config.
 * QStash delivers to the webhook handler at /api/webhooks/qstash-publish.
 */

import { getQStashClient } from '@/lib/qstash/client';
import { env } from '@/env';

interface DispatchOptions {
  jobId: string;
  deduplicationId: string;
  delaySeconds?: number;
}

/**
 * Dispatch a publish job to QStash for async processing.
 * Uses QStash's built-in deduplication (via deduplicationId) and retry (3 attempts).
 * QStash retries at 5m/15m/45m intervals on 500 responses.
 *
 * failureCallback: QStash calls this URL after all retries are exhausted.
 * This allows the system to record terminal failures without polling.
 */
export async function dispatchToQStash({ jobId, deduplicationId, delaySeconds }: DispatchOptions): Promise<void> {
  const client = getQStashClient();
  const baseUrl = env.client.NEXT_PUBLIC_SITE_URL;

  await client.publishJSON({
    url: `${baseUrl}/api/webhooks/qstash-publish`,
    body: { jobId },
    retries: 3,
    failureCallback: `${baseUrl}/api/webhooks/qstash-publish/failure`,
    headers: {
      'Upstash-Forward-Content-Type': 'application/json',
    },
    deduplicationId,
    ...(delaySeconds && delaySeconds > 0 ? { delay: delaySeconds } : {}),
  });
}
