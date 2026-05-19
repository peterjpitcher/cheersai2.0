/**
 * AI generation response schema for structured outputs.
 *
 * IMPORTANT: Keep flat objects -- no discriminated unions.
 * Zod v4 emits oneOf for unions which OpenAI strict mode rejects.
 *
 * IMPORTANT: OpenAI structured outputs require all fields to be present.
 * Use `.nullable()` instead of `.optional()` -- the API rejects optional fields.
 * See: https://platform.openai.com/docs/guides/structured-outputs
 */

import { z } from 'zod';

export const AiGenerationResponseSchema = z.object({
  facebook: z.object({
    body: z.string().describe('Facebook post body copy, max 300 words'),
    cta_text: z.string().nullable().describe('Call-to-action text'),
    hashtags: z.array(z.string()).nullable().describe('Relevant hashtags, max 5'),
  }),
  instagram: z.object({
    body: z.string().describe('Instagram caption, max 150 words'),
    hashtags: z.array(z.string()).nullable().describe('Up to 10 relevant hashtags'),
    link_in_bio_line: z.string().nullable().describe('Link-in-bio call-to-action line'),
  }),
  gbp: z.object({
    body: z.string().describe('Google Business Profile update, max 750 words'),
    cta_action: z
      .string()
      .nullable()
      .describe('CTA action type: LEARN_MORE, BOOK, ORDER, SIGN_UP, CALL'),
  }),
});

export type AiGenerationResponse = z.infer<typeof AiGenerationResponseSchema>;
