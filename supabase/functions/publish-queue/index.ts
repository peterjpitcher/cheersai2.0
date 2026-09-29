/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { readPublishQueueRequest } from "./request-options.ts";
import { PublishQueueWorker, createDefaultConfig } from "./worker.ts";

const config = createDefaultConfig();
const worker = new PublishQueueWorker(config);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    console.warn("[publish-queue] received non-JSON payload", error);
  }

  // The lead window is fixed (request-options.ts): a caller can no longer widen it.
  const { leadWindowMinutes, source, ignoredLeadWindow } = readPublishQueueRequest(payload);
  if (ignoredLeadWindow !== undefined) {
    console.warn("[publish-queue] ignored a caller's lead window", { requested: ignoredLeadWindow, source });
  }
  const result = await worker.processDueJobs(leadWindowMinutes, source);

  return Response.json({ ok: true, ...result });
});
