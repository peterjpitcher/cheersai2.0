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
import { getOpenAIClient } from "@/lib/ai/client";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { getOwnerSettings } from "@/lib/settings/data";
import { createInstantPost } from "@/lib/create/service";
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

  // --- Parse body ---
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let formValues: ReturnType<typeof instantPostFormSchema.parse>;
  try {
    formValues = instantPostFormSchema.parse(rawBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve to the domain input type (same transform as the server action)
  const input: InstantPostInput = instantPostSchema.parse({
    ...formValues,
    scheduledFor:
      formValues.publishMode === "schedule" && formValues.scheduledFor
        ? DateTime.fromISO(formValues.scheduledFor, { zone: DEFAULT_TIMEZONE }).toJSDate()
        : undefined,
  });

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

        const openai = getOpenAIClient();

        // Stream a preview for each platform (OpenAI call #1 per platform)
        for (const platform of input.platforms) {
          send({ type: "platform_start", platform });

          const prompt = buildInstantPostPrompt({
            brand,
            venueName,
            input,
            platform,
            scheduledFor: input.scheduledFor ?? null,
          });

          const responseStream = openai.responses.stream({
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

        // Persist (OpenAI call #2 — full generation + save via existing service)
        const result = await createInstantPost(input);

        send({ type: "done", contentItemIds: result.contentItemIds });
      } catch (error) {
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
