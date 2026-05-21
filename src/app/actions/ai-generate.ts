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
import type { BrandProfile } from '@/lib/settings/data';

/** Optional media + schedule context passed from the create wizard. */
interface GenerationContextInput {
  mediaIds?: string[];
  scheduledAt?: string | null;
  slotLabel?: string; // e.g. "Event day", "2 weeks out", "Launch", "Week 3"
}

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
  context?: GenerationContextInput,
): Promise<{ data?: PostprocessResult; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Load the configured brand voice (key phrases, banned phrases, signatures,
    // tone sliders, GBP CTA) from the brand_profile table — the same store the
    // Settings → Brand Voice form writes to.
    const brand = await loadBrandProfile(supabase, accountId);

    const voiceConfig: BrandVoiceConfig = {
      tone: brief.tone,
      style: null,
      defaultCta: brand.gbpCta ?? null,
      platformSignatures: brandSignatures(brand),
    };

    // Load media metadata for context-aware generation
    const mediaMetadata = await loadMediaMetadata(supabase, accountId, context?.mediaIds);

    const systemPrompt = buildSystemPrompt(brief.contentType, brief.tone, voiceConfig, brand);
    const userPrompt = buildUserPrompt(brief, undefined, {
      scheduledAt: context?.scheduledAt,
      media: mediaMetadata.length > 0 ? mediaMetadata : undefined,
      slotLabel: context?.slotLabel,
    });
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
      bannedPhrases: [...BANNED_PHRASES, ...brand.bannedPhrases.map((p) => p.trim()).filter(Boolean)],
      platformSignatures: voiceConfig.platformSignatures,
      defaultCta: voiceConfig.defaultCta,
    });

    // Store generation params and draft copy on content_items
    await supabase
      .from('content_items')
      .update({
        ai_generation_params: {
          brief,
          generationContext: {
            mediaIds: context?.mediaIds,
            scheduledAt: context?.scheduledAt,
            slotLabel: context?.slotLabel,
            mediaMetadata: mediaMetadata.length > 0 ? mediaMetadata : undefined,
          },
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
  context?: GenerationContextInput,
): Promise<{ data?: PostprocessResult; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Load the configured brand voice — see generateContent for details.
    const brand = await loadBrandProfile(supabase, accountId);

    const voiceConfig: BrandVoiceConfig = {
      tone: brief.tone,
      style: null,
      defaultCta: brand.gbpCta ?? null,
      platformSignatures: brandSignatures(brand),
    };

    // Load media metadata for context-aware generation
    const mediaMetadata = await loadMediaMetadata(supabase, accountId, context?.mediaIds);

    const systemPrompt = buildSystemPrompt(brief.contentType, brief.tone, voiceConfig, brand);
    const userPrompt = buildUserPrompt(brief, modifier, {
      scheduledAt: context?.scheduledAt,
      media: mediaMetadata.length > 0 ? mediaMetadata : undefined,
      slotLabel: context?.slotLabel,
    });
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
      bannedPhrases: [...BANNED_PHRASES, ...brand.bannedPhrases.map((p) => p.trim()).filter(Boolean)],
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
          generationContext: {
            mediaIds: context?.mediaIds,
            scheduledAt: context?.scheduledAt,
            slotLabel: context?.slotLabel,
            mediaMetadata: mediaMetadata.length > 0 ? mediaMetadata : undefined,
          },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load the brand voice profile, falling back to safe defaults if unset or missing. */
async function loadBrandProfile(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>['supabase'],
  accountId: string,
): Promise<BrandProfile> {
  const defaults: BrandProfile = {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [],
    bannedTopics: [],
    bannedPhrases: [],
    defaultHashtags: [],
    defaultEmojis: [],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: 'LEARN_MORE',
  };

  try {
    const { data, error } = await supabase
      .from('brand_profile')
      .select(
        'tone_formal, tone_playful, key_phrases, banned_topics, banned_phrases, default_hashtags, default_emojis, instagram_signature, facebook_signature, gbp_cta',
      )
      .eq('account_id', accountId)
      .maybeSingle<{
        tone_formal: number | null;
        tone_playful: number | null;
        key_phrases: string[] | null;
        banned_topics: string[] | null;
        banned_phrases: string[] | null;
        default_hashtags: string[] | null;
        default_emojis: string[] | null;
        instagram_signature: string | null;
        facebook_signature: string | null;
        gbp_cta: string | null;
      }>();

    if (error || !data) return defaults;

    return {
      toneFormal: data.tone_formal ?? defaults.toneFormal,
      tonePlayful: data.tone_playful ?? defaults.tonePlayful,
      keyPhrases: data.key_phrases ?? [],
      bannedTopics: data.banned_topics ?? [],
      bannedPhrases: data.banned_phrases ?? [],
      defaultHashtags: data.default_hashtags ?? [],
      defaultEmojis: data.default_emojis ?? [],
      instagramSignature: data.instagram_signature ?? undefined,
      facebookSignature: data.facebook_signature ?? undefined,
      gbpCta: data.gbp_cta ?? 'LEARN_MORE',
    };
  } catch {
    return defaults;
  }
}

/** Build the per-platform signature map from the brand profile (Facebook/Instagram only). */
function brandSignatures(brand: BrandProfile): Record<string, string> {
  const signatures: Record<string, string> = {};
  if (brand.facebookSignature?.trim()) signatures.facebook = brand.facebookSignature.trim();
  if (brand.instagramSignature?.trim()) signatures.instagram = brand.instagramSignature.trim();
  return signatures;
}

/** Load media asset metadata from DB, preserving the caller's selected order. */
async function loadMediaMetadata(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>['supabase'],
  accountId: string,
  mediaIds?: string[],
): Promise<Array<{
  id: string;
  fileName: string;
  mediaType: 'image' | 'video';
  tags: string[];
  aspectClass?: 'square' | 'story' | 'landscape';
}>> {
  if (!mediaIds?.length) return [];

  const { data: mediaAssets } = await supabase
    .from('media_assets')
    .select('id, file_name, media_type, tags, width, height')
    .in('id', mediaIds)
    .eq('account_id', accountId);

  if (!mediaAssets) return [];

  // Preserve the caller's selected order (important for carousel position)
  const assetMap = new Map(mediaAssets.map(a => [a.id, a]));
  return mediaIds
    .map(id => assetMap.get(id))
    .filter(Boolean)
    .map(a => ({
      id: a!.id,
      fileName: a!.file_name ?? 'unnamed',
      mediaType: (a!.media_type ?? 'image') as 'image' | 'video',
      tags: Array.isArray(a!.tags) ? a!.tags : [],
      aspectClass: deriveAspectClass(a!.width, a!.height),
    }));
}

/** Classify an image's aspect ratio for prompt context. */
function deriveAspectClass(
  width: number | null,
  height: number | null,
): 'square' | 'story' | 'landscape' | undefined {
  if (!width || !height) return undefined;
  const ratio = width / height;
  if (ratio >= 0.95 && ratio <= 1.05) return 'square';
  if (ratio < 0.75) return 'story';
  if (ratio > 1.3) return 'landscape';
  return undefined;
}
