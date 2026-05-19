import { Client, Receiver } from '@upstash/qstash';

let qstashClient: Client | null = null;
let qstashReceiver: Receiver | null = null;

/** Get the QStash client for publishing messages. Throws if UPSTASH_QSTASH_TOKEN is not set. */
export function getQStashClient(): Client {
  if (qstashClient) return qstashClient;
  const token = process.env.UPSTASH_QSTASH_TOKEN;
  if (!token) {
    throw new Error(
      'UPSTASH_QSTASH_TOKEN is not configured. QStash is required for the publish pipeline.',
    );
  }
  qstashClient = new Client({ token });
  return qstashClient;
}

/** Get the QStash receiver for verifying incoming webhook signatures. */
export function getQStashReceiver(): Receiver {
  if (qstashReceiver) return qstashReceiver;
  const currentSigningKey = process.env.UPSTASH_QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.UPSTASH_QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error(
      'QStash signing keys not configured. Set UPSTASH_QSTASH_CURRENT_SIGNING_KEY and UPSTASH_QSTASH_NEXT_SIGNING_KEY.',
    );
  }
  qstashReceiver = new Receiver({
    currentSigningKey,
    nextSigningKey,
  });
  return qstashReceiver;
}

/**
 * Verify that an incoming request was signed by QStash.
 * Use this in all webhook/queue handler routes.
 */
export async function verifyQStashSignature(request: Request): Promise<boolean> {
  const receiver = getQStashReceiver();
  const signature = request.headers.get('upstash-signature');
  if (!signature) return false;

  const body = await request.text();
  try {
    await receiver.verify({ signature, body });
    return true;
  } catch {
    return false;
  }
}
