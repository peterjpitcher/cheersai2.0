/**
 * What a caller may ask of publish-queue.
 *
 * Both callers (the publish-scheduler cron bridge and tournament publishing)
 * ask for a five-minute lead window. The function used to trust whatever
 * window a caller sent, and the public anon key passes the platform's JWT
 * check, so anyone could have asked for a window of weeks and had scheduled
 * posts published early (tasks/SPEC-supabase-new-api-keys.md, Findings). The
 * window is now fixed. `source` is only a label for logs and the heartbeat,
 * so it is kept short.
 */
export const LEAD_WINDOW_MINUTES = 5;

const MAX_SOURCE_LENGTH = 64;

export interface PublishQueueRequest {
  /** Always LEAD_WINDOW_MINUTES, whatever the caller sent. */
  leadWindowMinutes: number;
  source: string;
  /** The caller's own lead window when it was something else, for the log; otherwise undefined. */
  ignoredLeadWindow: unknown;
}

export function readPublishQueueRequest(payload: unknown): PublishQueueRequest {
  const body = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const requested = body.leadWindowMinutes;
  const source =
    typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, MAX_SOURCE_LENGTH) : "unknown";
  return {
    leadWindowMinutes: LEAD_WINDOW_MINUTES,
    source,
    ignoredLeadWindow: requested !== undefined && requested !== LEAD_WINDOW_MINUTES ? requested : undefined,
  };
}
