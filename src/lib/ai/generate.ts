/**
 * Core AI generation function with structured outputs (AI-01, AI-05, AI-09).
 *
 * Uses OpenAI's `chat.completions.parse()` with `zodResponseFormat` to
 * validate AI responses against the AiGenerationResponseSchema at the API level.
 * Includes a 30-second timeout with graceful error handling.
 */

import { zodResponseFormat } from 'openai/helpers/zod';

import { getOpenAIClient } from './client';
import { AiGenerationResponseSchema, type AiGenerationResponse } from './schemas';

export interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  model?: string;
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
    const completion = await client.chat.completions.parse(
      {
        model: options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
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
    );

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error(
        'AI returned no parsed content. Please try again.',
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        'Content generation timed out after 30 seconds. Please try again with a simpler brief.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
