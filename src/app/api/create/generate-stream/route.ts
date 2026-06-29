/**
 * POST /api/create/generate-stream
 *
 * Streaming route handler for instant post generation.
 *
 * Design: OpenAI is called once per platform for the streaming preview, then
 * `createInstantPost()` is called once at the end to do the real save. This
 * results in two OpenAI API calls per generation (one for preview, one for
 * save). We accept that trade-off because replicating the full generate+save
 * pipeline here would duplicate a large amount of complex business logic that
 * lives in service.ts, and the UX improvement from real streaming is
 * significant.
 */

import { NextRequest } from "next/server";
import { DateTime } from "luxon";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAccountId } from "@/lib/auth/server";
import { getRateLimitKey, isRateLimited } from "@/lib/auth/rate-limit";
import { getOpenAIClient } from "@/lib/ai/client";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { getOwnerSettings } from "@/lib/settings/data";
import { createInstantPost } from "@/lib/create/service";
import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";
import {
  instantPostFormSchema,
  instantPostSchema,
  type InstantPostInput,
} from "@/lib/create/schema";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export const dynamic = "force-dynamic";

// SSE event types emitted by this handler
type StreamEvent =
  | { type: "platform_start"; platform: string }
  | { type: "chunk"; platform: string; text: string }
  | { type: "platform_done"; platform: string }
  | { type: "story_no_caption"; platform: string }
  | { type: "done"; contentItemIds: string[] }
  | { type: "error"; message: string };

function encode(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest): Promise<Response> {
  // --- Auth ---
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accountId = resolveAccountId(user);
  if (!accountId) {
    return new Response(JSON.stringify({ error: "Account not found" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Rate limit (per account) — before any parsing or generation ---
  // Generation triggers OpenAI calls, so cap requests per account. Uses the
  // shared limiter; no-op when Upstash is not configured (dev/local).
  const rateLimitKey = getRateLimitKey(request, `create:generate-stream:${accountId}`);
  const limited = await isRateLimited({
    key: rateLimitKey,
    maxAttempts: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Parse body ---
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    console.error("[create/generate-stream] Failed to parse JSON body", err);
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let formValues: ReturnType<typeof instantPostFormSchema.parse>;
  try {
    formValues = instantPostFormSchema.parse(rawBody);
  } catch (err) {
    console.error("[create/generate-stream] Invalid request payload", err);
    const message = err instanceof Error ? err.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve to the domain input type (same transform as the server action)
  let input: InstantPostInput;
  try {
    const storyScheduledFor =
      formValues.placement === "story"
        ? resolveStoryScheduledFor(formValues.scheduledFor ?? new Date(), DEFAULT_TIMEZONE)
        : null;
    input = instantPostSchema.parse({
      ...formValues,
      publishMode: storyScheduledFor ? "schedule" : formValues.publishMode,
      scheduledFor:
        storyScheduledFor ??
        (formValues.publishMode === "schedule" && formValues.scheduledFor
          ? DateTime.fromISO(formValues.scheduledFor, { zone: DEFAULT_TIMEZONE }).toJSDate()
          : undefined),
      // Carry the optional banner override through to createInstantPost so the
      // service layer can write an explicit banner_enabled to the variant row.
      banner: formValues.banner,
    });
  } catch (err) {
    console.error("[create/generate-stream] Failed to resolve post input", err);
    const message = err instanceof Error ? err.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Build the SSE stream ---
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(encode(event)));
      };

      try {
        // Load settings once — needed to build prompts
        const { brand, venueName } = await getOwnerSettings();

        // Stream a preview for each platform (OpenAI call #1 per platform).
        //
        // Stories are image-only on Facebook and Instagram — the providers
        // discard any caption at publish time. Skip OpenAI entirely for them
        // (including the client factory) so a story-only submission works
        // even when OPENAI_API_KEY is missing or the factory throws.
        for (const platform of input.platforms) {
          if (input.placement === "story") {
            send({ type: "story_no_caption", platform });
            continue;
          }

          send({ type: "platform_start", platform });

          const prompt = buildInstantPostPrompt({
            brand,
            venueName,
            input,
            platform,
            scheduledFor: input.scheduledFor ?? null,
          });

          const responseStream = getOpenAIClient().responses.stream({
            model: "gpt-4.1-mini",
            input: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            temperature: 0.7,
          });

          for await (const event of responseStream) {
            if (
              event.type === "response.output_text.delta" &&
              typeof event.delta === "string" &&
              event.delta.length > 0
            ) {
              send({ type: "chunk", platform, text: event.delta });
            }
          }

          send({ type: "platform_done", platform });
        }

        // Persist (OpenAI call #2 — full generation + save via existing service).
        // Runs for BOTH story and feed flows so the form can render the saved
        // drafts via the final `done` event.
        const result = await createInstantPost(input);

        send({ type: "done", contentItemIds: result.contentItemIds });
      } catch (error) {
        console.error(
          "[create/generate-stream] Content generation failed",
          error,
        );
        const message =
          error instanceof Error ? error.message : "Content generation failed.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
