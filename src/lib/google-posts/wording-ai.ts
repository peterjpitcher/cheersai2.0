/**
 * The OpenAI call behind Google wording (./wording.ts decides what to do with
 * the draft). Server only. Kept apart so the job's logic can be tested with a
 * fake writer and never reaches OpenAI.
 *
 * Uses the copy model the rest of the app uses, a plain-text reply held to a
 * small schema, and a timeout shorter than the cron's budget for one call.
 * Each call is recorded against the brand in the AI usage log as post copy.
 */

import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import { getOpenAIClient } from "@/lib/ai/client";
import { isReasoningModel, resolveCopyModel } from "@/lib/ai/models";
import { trackAiCall } from "@/lib/ai/usage";
import {
  buildGoogleWordingPrompt,
  GOOGLE_WORDING_SYSTEM_PROMPT,
  type GoogleWordingWriter,
} from "@/lib/google-posts/wording";

/** One draft may take this long; the cron allows for it before starting a call. */
export const GOOGLE_WORDING_TIMEOUT_MS = 45_000;

const GoogleWordingSchema = z.object({
  wording: z.string().describe("The Google post wording, plain text, paragraphs separated by a blank line."),
});

export const writeGoogleWordingWithAi: GoogleWordingWriter = async (input, context) => {
  const client = getOpenAIClient();
  const model = resolveCopyModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_WORDING_TIMEOUT_MS);
  try {
    const completion = await trackAiCall({ accountId: context.accountId, feature: "post_copy" }, model, () =>
      client.chat.completions.parse(
        {
          model,
          // Reasoning models reject a custom temperature. Otherwise keep it low: this is a rewrite, not new copy.
          ...(isReasoningModel(model) ? {} : { temperature: 0.4 }),
          messages: [
            { role: "system", content: GOOGLE_WORDING_SYSTEM_PROMPT },
            { role: "user", content: buildGoogleWordingPrompt(input) },
          ],
          response_format: zodResponseFormat(GoogleWordingSchema, "google_wording"),
        },
        { signal: controller.signal },
      ),
    );
    return completion.choices[0]?.message?.parsed?.wording ?? "";
  } finally {
    clearTimeout(timeout);
  }
};
