/**
 * Core AI generation function with structured outputs (AI-01, AI-05, AI-09).
 *
 * Uses OpenAI's `chat.completions.parse()` with `zodResponseFormat` to
 * validate AI responses against the AiGenerationResponseSchema at the API level.
 * Includes a 30-second timeout with graceful error handling.
 */

import { zodResponseFormat } from 'openai/helpers/zod';

import { getOpenAIClient } from './client';
import { trackAiCall } from './usage';
import { AiGenerationResponseSchema, type AiGenerationResponse } from './schemas';

/**
 * Failures whose message is written for the owner, so the create screen shows
 * it as it is (tasks/SPEC-plain-error-messages.md). Any other failure (an
 * OpenAI error, a missing key) is logged and replaced with plain words.
 */
export const AI_OWNER_MESSAGES = {
  empty: 'The AI did not write any copy this time. Please try again.',
  timeout: 'Content generation timed out after 30 seconds. Please try again with a simpler brief.',
} as const;

export interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  model?: string;
  /** Brand to record this call against (AI usage log). */
  usageAccountId?: string;
}

/**
 * Generate platform-specific copy using OpenAI structured outputs.
 *
 * @param options - System prompt, user prompt, temperature, and optional model override
 * @returns Validated AiGenerationResponse matching the Zod schema
 * @throws Error with descriptive message on timeout or empty response
 */
export async function generatePlatformCopy(
  options: GenerateOptions,
): Promise<AiGenerationResponse> {
  const client = getOpenAIClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // AI-09: 30s timeout

  try {
    const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const usage = options.usageAccountId ? { accountId: options.usageAccountId, feature: 'post_copy' as const } : undefined;
    const completion = await trackAiCall(usage, model, () => client.chat.completions.parse(
      {
        model,
        temperature: options.temperature,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.userPrompt },
        ],
        response_format: zodResponseFormat(
          AiGenerationResponseSchema,
          'platform_copy',
        ),
      },
      { signal: controller.signal },
    ));

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error(AI_OWNER_MESSAGES.empty);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(AI_OWNER_MESSAGES.timeout);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
