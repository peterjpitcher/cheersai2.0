'use server';

/**
 * Server actions for AI content generation (AI-01, AI-02, AI-03).
 *
 * generateContent: generates platform-specific copy from a brief
 * regenerateWithModifier: regenerates with an appended instruction modifier
 */

import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import { generatePlatformCopy } from '@/lib/ai/generate';
import type { PostprocessResult } from '@/lib/ai/postprocess';
import { postprocessCopy } from '@/lib/ai/postprocess';
import { buildSystemPrompt, buildUserPrompt } from '@/lib/ai/prompts';
import { getTemperature } from '@/lib/ai/temperature';
import { BANNED_PHRASES, type BrandVoiceConfig } from '@/lib/ai/voice';
import { requireAuthContext } from '@/lib/auth/server';

// Default post-processing limits per platform
const MAX_HASHTAGS: Record<string, number> = { facebook: 5, instagram: 10, gbp: 3 };
const MAX_EMOJIS: Record<string, number> = { facebook: 3, instagram: 3, gbp: 2 };
const MAX_WORDS: Record<string, number> = { facebook: 300, instagram: 150, gbp: 750 };

/**
 * Generate platform-specific copy from a content brief.
 *
 * 1. Authenticates the user
 * 2. Loads brand voice from profiles table
 * 3. Builds system/user prompts
 * 4. Calls OpenAI with structured outputs
 * 5. Post-processes the result (banned phrases, emoji/hashtag clamping)
 * 6. Stores generation params on content_items
 * 7. Returns processed copy with any warnings
 */
export async function generateContent(
  contentId: string,
  brief: ContentBrief,
): Promise<{ data?: PostprocessResult; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Load brand voice from profiles table
    const { data: profile } = await supabase
      .from('profiles')
      .select('brand_voice_tone, brand_voice_style, default_cta')
      .eq('account_id', accountId)
      .maybeSingle<{
        brand_voice_tone: string | null;
        brand_voice_style: string | null;
        default_cta: string | null;
      }>();

    // Build voice config from profile data
    const voiceConfig: BrandVoiceConfig = {
      tone: profile?.brand_voice_tone ?? brief.tone,
      style: profile?.brand_voice_style ?? null,
      defaultCta: profile?.default_cta ?? null,
      platformSignatures: {},
    };

    const systemPrompt = buildSystemPrompt(brief.contentType, brief.tone, voiceConfig);
    const userPrompt = buildUserPrompt(brief);
    const temperature = getTemperature(brief.contentType);

    const rawCopy = await generatePlatformCopy({
      systemPrompt,
      userPrompt,
      temperature,
    });

    const processed = postprocessCopy(rawCopy, {
      maxHashtags: MAX_HASHTAGS,
      maxEmojis: MAX_EMOJIS,
      maxWords: MAX_WORDS,
      bannedPhrases: BANNED_PHRASES,
      platformSignatures: voiceConfig.platformSignatures,
      defaultCta: voiceConfig.defaultCta,
    });

    // Store generation params and draft copy on content_items
    await supabase
      .from('content_items')
      .update({
        ai_generation_params: {
          brief,
          temperature,
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        },
        body_draft: processed.copy,
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    return { data: processed };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Content generation failed. Please try again.';
    console.error('[ai-generate] generateContent error:', message);
    return { error: message };
  }
}

/**
 * Regenerate copy with a modifier appended to the prompt (AI-03).
 *
 * Same flow as generateContent but includes a modifier instruction
 * appended to the user prompt for targeted adjustments.
 */
export async function regenerateWithModifier(
  contentId: string,
  brief: ContentBrief,
  modifier: string,
): Promise<{ data?: PostprocessResult; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Load brand voice from profiles table
    const { data: profile } = await supabase
      .from('profiles')
      .select('brand_voice_tone, brand_voice_style, default_cta')
      .eq('account_id', accountId)
      .maybeSingle<{
        brand_voice_tone: string | null;
        brand_voice_style: string | null;
        default_cta: string | null;
      }>();

    const voiceConfig: BrandVoiceConfig = {
      tone: profile?.brand_voice_tone ?? brief.tone,
      style: profile?.brand_voice_style ?? null,
      defaultCta: profile?.default_cta ?? null,
      platformSignatures: {},
    };

    const systemPrompt = buildSystemPrompt(brief.contentType, brief.tone, voiceConfig);
    const userPrompt = buildUserPrompt(brief, modifier);
    const temperature = getTemperature(brief.contentType);

    const rawCopy = await generatePlatformCopy({
      systemPrompt,
      userPrompt,
      temperature,
    });

    const processed = postprocessCopy(rawCopy, {
      maxHashtags: MAX_HASHTAGS,
      maxEmojis: MAX_EMOJIS,
      maxWords: MAX_WORDS,
      bannedPhrases: BANNED_PHRASES,
      platformSignatures: voiceConfig.platformSignatures,
      defaultCta: voiceConfig.defaultCta,
    });

    // Store generation params with modifier
    await supabase
      .from('content_items')
      .update({
        ai_generation_params: {
          brief,
          modifier,
          temperature,
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        },
        body_draft: processed.copy,
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    return { data: processed };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Content regeneration failed. Please try again.';
    console.error('[ai-generate] regenerateWithModifier error:', message);
    return { error: message };
  }
}
