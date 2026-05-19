import { Axiom } from '@axiomhq/js';

let axiomInstance: Axiom | null = null;

function getAxiomClient(): Axiom | null {
  if (axiomInstance) return axiomInstance;
  const token = process.env.AXIOM_TOKEN;
  if (!token) return null;
  axiomInstance = new Axiom({ token });
  return axiomInstance;
}

/** Send structured log events to Axiom. No-op if AXIOM_TOKEN is not configured. */
export function sendToAxiom(dataset: string, events: Record<string, unknown>[]): void {
  const client = getAxiomClient();
  if (!client) return;
  client.ingest(dataset, events);
}

/** Flush pending Axiom events. Safe to call even if Axiom is not configured. */
export async function flushAxiom(): Promise<void> {
  const client = getAxiomClient();
  if (!client) return;
  await client.flush();
}
