/**
 * POST /api/create/event-artwork
 *
 * Copies one management-app event's designed artwork into the media library and
 * hands back a library summary the wizard can select immediately.
 *
 * A route handler rather than a Server Action for two reasons. Sharp needs the
 * Node runtime, and this work needs its own time budget: Next.js applies
 * `maxDuration` per page segment, so raising it for a Server Action would raise
 * it for every action on /create, not just this one.
 *
 * The only trusted input is an event identifier. The account, the management
 * connection, the artwork URLs and every storage path are derived server-side.
 * Accepting a storage path or a source key from the client would let one account
 * write into another's media.
 */

import { NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/server";
import { getRateLimitKey, isRateLimited } from "@/lib/auth/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { getManagementConnectionConfig } from "@/lib/management-app/data";
import { getManagementEventDetail, ManagementApiError } from "@/lib/management-app/client";
import { importEventArtwork } from "@/lib/management-app/artwork-import";

export const runtime = "nodejs";

/**
 * The platform ceiling. The internal deadline below is deliberately shorter, so
 * a slow import gives up and cleans up after itself rather than being killed
 * part-way through writing storage objects.
 */
export const maxDuration = 60;

const INTERNAL_DEADLINE_MS = 45_000;

const bodySchema = z.object({
  eventId: z.string().trim().min(1, "Event id required"),
  eventSlug: z.string().trim().min(1).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + INTERNAL_DEADLINE_MS;
  const correlationId = crypto.randomUUID();

  const user = await getCurrentUser();
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const accountId = user.activeAccountId;
  if (!accountId) {
    return json({ error: "No active brand" }, 403);
  }

  // Each import downloads and re-renders several megabytes, so it is capped per
  // account rather than left open to a loop in the browser.
  const limited = await isRateLimited({
    key: getRateLimitKey(request, `create:event-artwork:${accountId}`),
    maxAttempts: 30,
    windowMs: 60_000,
  });
  if (limited) {
    return json({ error: "Rate limit exceeded" }, 429);
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  try {
    const config = await getManagementConnectionConfig();

    // Resolve the event first. It confirms the identifier really is an event on
    // this connection, and it is what makes a later 404 on the artwork route
    // mean "this management app predates the endpoint" rather than "no such
    // event". Without it the two are indistinguishable and a provisioning gap
    // would be reported to the user as a normal empty result.
    let eventName = "Event";
    let resolvedEventId = payload.eventId;
    try {
      const detail = await getManagementEventDetail(config, payload.eventId, {
        fallbackSlug: payload.eventSlug,
      });
      eventName = detail.name?.trim() || eventName;
      resolvedEventId = detail.id;
    } catch (error) {
      if (error instanceof ManagementApiError && error.status === 404) {
        return json(
          {
            status: "unavailable",
            warning: "That event is no longer in the management app.",
          },
          200,
        );
      }
      throw error;
    }

    const supabase = createServiceSupabaseClient();

    const outcome = await importEventArtwork({
      supabase,
      config,
      accountId,
      eventId: resolvedEventId,
      eventName,
      deadlineAt,
    });

    // One line per import. Enough to tell a provisioning gap from a slow host
    // from a genuine no-artwork event, without carrying anything sensitive: no
    // keys, no cookies, no signed URLs.
    console.info("[create/event-artwork]", {
      correlationId,
      accountId,
      eventId: resolvedEventId,
      result: outcome.status,
      errorClass: outcome.errorClass ?? null,
      sourceCounts: outcome.sourceCounts,
      stageMs: outcome.stageMs,
      bytesIn: outcome.bytesIn,
      bytesOut: outcome.bytesOut,
      elapsedMs: Date.now() - startedAt,
    });

    return json({
      status: outcome.status,
      asset: outcome.asset ?? null,
      warning: outcome.warning ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Artwork import failed";

    // A connection that is missing or switched off is a settings problem, not a
    // fault, and must not read as "this event has no artwork".
    const isConnectionProblem =
      /not configured|disabled|schema is missing/i.test(message) ||
      (error instanceof ManagementApiError &&
        (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN"));

    console.error("[create/event-artwork] failed", {
      correlationId,
      accountId,
      errorClass: isConnectionProblem ? "unavailable_connection" : "unexpected",
      elapsedMs: Date.now() - startedAt,
    });

    return json({
      status: isConnectionProblem ? "unavailable" : "failed",
      asset: null,
      warning: isConnectionProblem
        ? "Artwork import is not available for this management app connection."
        : "Event artwork could not be imported. Add media in the next step.",
    });
  }
}
