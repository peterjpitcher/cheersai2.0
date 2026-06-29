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
    body: z.string().describe('Facebook post body copy. No URLs, domains, hashtags, or markdown links'),
    cta_text: z.string().nullable().describe('Short call-to-action text only. No URL or domain'),
    hashtags: z.array(z.string()).nullable().describe('Relevant hashtags with # prefix, max 5'),
  }),
  instagram: z.object({
    body: z.string().describe('Instagram caption body. No URLs, domains, booking links, hashtags, or link-in-bio line'),
    hashtags: z.array(z.string()).nullable().describe('Relevant hashtags with # prefix, max 10'),
    link_in_bio_line: z.string().nullable().describe('Link-in-bio call-to-action line. Use link-in-bio wording only; never include a URL or domain'),
  }),
});

export type AiGenerationResponse = z.infer<typeof AiGenerationResponseSchema>;
