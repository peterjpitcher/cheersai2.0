/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { CALLER_CHECK_ENFORCED, checkCaller, logCallerVerdict } from "./caller-auth.ts";
import { readPublishQueueRequest } from "./request-options.ts";
import { PublishQueueWorker, createDefaultConfig } from "./worker.ts";

const config = createDefaultConfig();
const worker = new PublishQueueWorker(config);
const readEnv = (name: string) => Deno.env.get(name);

Deno.serve(async (request: Request) => {
  // Who is calling, before the method check and before the body is read (caller-auth.ts). While
  // CALLER_CHECK_ENFORCED is false (step 1, report-only) a refused caller is only logged.
  const caller = await checkCaller(request.headers, readEnv);
  logCallerVerdict(caller, { method: request.method, enforced: CALLER_CHECK_ENFORCED });
  if (CALLER_CHECK_ENFORCED && !caller.accepted) {
    return new Response(null, { status: 401 });
  }

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
