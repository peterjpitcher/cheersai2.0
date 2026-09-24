/**
 * AI media naming + tagging (vision).
 *
 * Given a signed image URL, asks OpenAI for a short human-friendly name and a
 * handful of keyword tags. Used to auto-label images uploaded via the /library
 * page, where, unlike the create wizard, there is no campaign name to tag with.
 *
 * Mirrors `generate.ts`: `chat.completions.parse()` + `zodResponseFormat` for
 * validated structured output, with a 30-second abort timeout.
 */

import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import { getOpenAIClient } from './client';
import { trackAiCall } from './usage';

/** Max number of AI-suggested tags applied to an asset. */
export const MAX_MEDIA_TAGS = 6;

/** Cap on the generated file name length (label only, the storage path is sanitised separately). */
const MAX_FILE_NAME_LENGTH = 80;

/**
 * Whitelist for display file names: keep letters, numbers, spaces and a few safe
 * punctuation marks; strip everything else (filesystem-illegal and control chars).
 */
const UNSAFE_FILENAME_CHARS = /[^\p{L}\p{N} '&(),.-]/gu;

// OpenAI structured outputs require all fields present (no `.optional()`); keep the
// object flat, Zod v4 unions emit `oneOf`, which OpenAI strict mode rejects.
const MediaTagResponseSchema = z.object({
  name: z
    .string()
    .describe(
      'A short, human-friendly title for the image in Title Case, 2 to 6 words. No file extension, no punctuation.',
    ),
  tags: z
    .array(z.string())
    .describe(
      'Between 3 and 6 short lowercase keyword tags describing the subject, setting, any food or drink, and the mood. Single words or short phrases. No "#" symbol.',
    ),
});

/**
 * System prompt for tagging. Without a business type the brand is treated as a pub (the
 * original wording, unchanged); with one, the library is described as that business's.
 */
export function buildMediaTaggingSystemPrompt(businessType?: string): string {
  const type = businessType?.trim();
  const library = type
    ? `the media library of a UK business (${type}). `
    : 'a UK hospitality venue (pub, bar, or restaurant) media library. ';
  return (
    `You label photos for ${library}` +
    'Give each image a concise, descriptive title and a few practical keyword tags the owner ' +
    'could search by. Be literal about what is shown; do not invent brand names or text that is ' +
    'not visible. Use British English.'
  );
}

const USER_PROMPT =
  'Provide a short title and 3 to 6 keyword tags for this image, following the schema.';

export interface GenerateMediaNameAndTagsInput {
  /** Publicly reachable (e.g. signed) URL to the image. */
  imageUrl: string;
  /** Optional model override; defaults to the configured copy model. */
  model?: string;
  /** The brand's business type from Settings; unset means a pub. */
  businessType?: string;
  /** Brand to record this call against (AI usage log). */
  usageAccountId?: string;
}

export interface MediaNameAndTags {
  name: string;
  tags: string[];
}

/**
 * Ask OpenAI vision for a name and tags for the image at `imageUrl`.
 *
 * @throws Error on timeout, empty response, or API failure. Callers should treat
 *   a throw as "leave the asset unchanged" rather than surfacing it to the user.
 */
export async function generateMediaNameAndTags(
  input: GenerateMediaNameAndTagsInput,
): Promise<MediaNameAndTags> {
  const client = getOpenAIClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const model = input.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const usage = input.usageAccountId ? { accountId: input.usageAccountId, feature: 'media_tagging' as const } : undefined;
    const completion = await trackAiCall(usage, model, () => client.chat.completions.parse(
      {
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: buildMediaTaggingSystemPrompt(input.businessType) },
          {
            role: 'user',
            content: [
              { type: 'text', text: USER_PROMPT },
              // `detail: 'low'` keeps token cost and latency down, tagging does not need fine detail.
              { type: 'image_url', image_url: { url: input.imageUrl, detail: 'low' } },
            ],
          },
        ],
        response_format: zodResponseFormat(MediaTagResponseSchema, 'media_name_and_tags'),
      },
      { signal: controller.signal },
    ));

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error('AI returned no parsed content for media tagging.');
    }
    return { name: parsed.name, tags: parsed.tags };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Media tagging timed out after 30 seconds.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Return the lowercased extension (including the dot) of a file name, or an empty
 * string when there is none. E.g. "IMG_1234.JPG" -> ".jpg".
 */
export function deriveExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? `.${match[1].toLowerCase()}` : '';
}

/**
 * Build a display file name from an AI-suggested title, preserving the original
 * file's extension. Falls back to the original name when the AI title is unusable.
 */
export function buildMediaFileName(aiName: string, originalFileName: string): string {
  let cleaned = aiName
    .replace(UNSAFE_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\-\s]+$/, '');

  if (cleaned.length > MAX_FILE_NAME_LENGTH) {
    cleaned = cleaned.slice(0, MAX_FILE_NAME_LENGTH).replace(/[.\-\s]+$/, '');
  }

  if (!cleaned) {
    return originalFileName;
  }

  const ext = deriveExtension(originalFileName);
  const alreadyHasExtension = deriveExtension(cleaned) !== '';
  if (ext && !alreadyHasExtension) {
    return `${cleaned}${ext}`;
  }
  return cleaned;
}
