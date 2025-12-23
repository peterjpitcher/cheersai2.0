/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { PublishQueueWorker, createDefaultConfig, type PublishJobPayload } from "./worker.ts";

const config = createDefaultConfig();
const worker = new PublishQueueWorker(config);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: PublishJobPayload | undefined;
  try {
    payload = await request.json();
  } catch (error) {
    console.warn("[publish-queue] received non-JSON payload", error);
  }

  const leadWindowMinutes = payload?.leadWindowMinutes ?? 5;
  const source = payload?.source ?? "unknown";
  const result = await worker.processDueJobs(leadWindowMinutes, source);

  return Response.json({ ok: true, ...result });
});
