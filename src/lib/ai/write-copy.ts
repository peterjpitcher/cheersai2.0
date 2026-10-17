import type { SupabaseClient } from '@supabase/supabase-js';

import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import { generatePlatformCopy } from '@/lib/ai/generate';
import { findCopyIssues, postprocessCopy, type PostprocessResult } from '@/lib/ai/postprocess';
import { INSTAGRAM_HASHTAG_LIMIT, buildSystemPrompt, buildUserPrompt } from '@/lib/ai/prompts';
import { getTemperature } from '@/lib/ai/temperature';
import { BANNED_PHRASES, type BrandVoiceConfig } from '@/lib/ai/voice';
import { buildGenerationTemporalContext, type GenerationTemporalContext } from '@/lib/create/temporal-context';
import type { BrandProfile } from '@/lib/settings/data';

/**
 * Writing one post's copy, shared by the create wizard's server actions and the
 * ops tool that rewrites scheduled posts (tasks/SPEC-event-copy-engine.md B1
 * and B8), so both go through exactly the same prompts, tidying and checks.
 */

const MAX_HASHTAGS: Record<string, number> = { facebook: 5, instagram: INSTAGRAM_HASHTAG_LIMIT };
const MAX_EMOJIS: Record<string, number> = { facebook: 3, instagram: 3 };
const MAX_WORDS: Record<string, number> = { facebook: 300, instagram: 150 };

export interface MediaMetadata {
  id: string;
  fileName: string;
  mediaType: 'image' | 'video';
  tags: string[];
  aspectClass?: 'square' | 'story' | 'landscape';
}

export interface WriteCopyInput {
  brief: ContentBrief;
  brand: BrandProfile;
  accountId: string;
  scheduledAt?: string | null;
  slotLabel?: string;
  media?: MediaMetadata[];
  modifier?: string;
}

export interface WriteCopyResult {
  processed: PostprocessResult;
  temporal: GenerationTemporalContext;
  temperature: number;
}

/** The brand's own signatures, Facebook and Instagram only. */
export function brandSignatures(brand: BrandProfile): Record<string, string> {
  const signatures: Record<string, string> = {};
  if (brand.facebookSignature?.trim()) signatures.facebook = brand.facebookSignature.trim();
  if (brand.instagramSignature?.trim()) signatures.instagram = brand.instagramSignature.trim();
  return signatures;
}

/** A brand_profile row as the prompts expect it, with safe defaults. */
export function toBrandProfile(row: Record<string, unknown> | null | undefined): BrandProfile {
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  const number = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);
  return {
    toneFormal: number(row?.tone_formal, 0.5),
    tonePlayful: number(row?.tone_playful, 0.5),
    keyPhrases: list(row?.key_phrases),
    bannedTopics: list(row?.banned_topics),
    bannedPhrases: list(row?.banned_phrases),
    defaultHashtags: list(row?.default_hashtags),
    defaultEmojis: list(row?.default_emojis),
    instagramSignature: text(row?.instagram_signature),
    facebookSignature: text(row?.facebook_signature),
    businessType: text(row?.business_type),
    businessDescription: text(row?.business_description),
  };
}

const BRAND_PROFILE_COLUMNS =
  'tone_formal, tone_playful, key_phrases, banned_topics, banned_phrases, default_hashtags, default_emojis, instagram_signature, facebook_signature, business_type, business_description';

/** Load the brand voice profile, falling back to safe defaults if unset or missing. */
export async function loadBrandProfile(db: SupabaseClient, accountId: string): Promise<BrandProfile> {
  try {
    const { data, error } = await db
      .from('brand_profile')
      .select(BRAND_PROFILE_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle<Record<string, unknown>>();
    return toBrandProfile(error ? null : data);
  } catch {
    return toBrandProfile(null);
  }
}

/** Load media asset metadata from DB, preserving the caller's selected order. */
export async function loadMediaMetadata(
  db: SupabaseClient,
  accountId: string,
  mediaIds?: string[] | null,
): Promise<MediaMetadata[]> {
  if (!mediaIds?.length) return [];

  const { data: mediaAssets } = await db
    .from('media_assets')
    .select('id, file_name, media_type, tags, width, height')
    .in('id', mediaIds)
    .eq('account_id', accountId);

  if (!mediaAssets) return [];

  // Preserve the caller's selected order (important for carousel position)
  const assetMap = new Map(mediaAssets.map((asset) => [asset.id as string, asset]));
  return mediaIds.flatMap((id) => {
    const asset = assetMap.get(id);
    if (!asset) return [];
    return [{
      id: asset.id as string,
      fileName: (asset.file_name as string | null) ?? 'unnamed',
      mediaType: ((asset.media_type as string | null) ?? 'image') as 'image' | 'video',
      tags: Array.isArray(asset.tags) ? (asset.tags as string[]) : [],
      aspectClass: deriveAspectClass(asset.width as number | null, asset.height as number | null),
    }];
  });
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

/**
 * Write, tidy and check one post. When the first draft breaks the house style
 * (a stock opening, repeated filler, more than one question or an empty one),
 * the model rewrites once with the problems listed; anything still wrong after
 * that is returned as a warning for the owner rather than blocking the post.
 */
export async function writeCopy(input: WriteCopyInput): Promise<WriteCopyResult> {
  const { brief, brand, accountId, scheduledAt, slotLabel, media, modifier } = input;
  const voiceConfig: BrandVoiceConfig = {
    tone: brief.tone,
    style: null,
    defaultCta: null,
    platformSignatures: brandSignatures(brand),
  };
  // Rotates the saved key phrases between a campaign's posts, stable per slot.
  const systemPrompt = buildSystemPrompt(brief.contentType, brief.tone, voiceConfig, brand, {
    keyPhraseSeed: `${slotLabel ?? ''}|${scheduledAt ?? ''}`,
  });
  // Every temporal fact is derived here from the brief and the slot's time, so
  // one clock feeds the prompt, the tidying and the stored generation params.
  // An absent scheduledAt means "publish now" and resolves against the server
  // clock; an unparseable one yields no temporal claims rather than "now".
  const temporal = buildGenerationTemporalContext({
    contentType: brief.contentType,
    brief: brief as unknown as Record<string, unknown>,
    scheduledAt,
  });
  const userPrompt = buildUserPrompt(brief, modifier, {
    scheduledAt,
    media: media?.length ? media : undefined,
    slotLabel,
    ...temporal,
  });
  const temperature = getTemperature(brief.contentType);
  const postprocessConfig: Parameters<typeof postprocessCopy>[1] = {
    maxHashtags: MAX_HASHTAGS,
    maxEmojis: MAX_EMOJIS,
    maxWords: MAX_WORDS,
    bannedPhrases: [...BANNED_PHRASES, ...brand.bannedPhrases.map((phrase) => phrase.trim()).filter(Boolean)],
    platformSignatures: voiceConfig.platformSignatures,
    defaultCta: voiceConfig.defaultCta,
    ctaLinks: brief.ctaLinks ?? null,
    eventStartIso: temporal.eventStart ?? null,
    allowedRelativeWording: temporal.allowedRelativeWording,
  };

  const first = postprocessCopy(
    await generatePlatformCopy({ systemPrompt, userPrompt, temperature, usageAccountId: accountId }),
    postprocessConfig,
  );
  const issues = findCopyIssues(first.copy);
  if (!issues.length) return { processed: first, temporal, temperature };

  const rewritten = postprocessCopy(
    await generatePlatformCopy({
      systemPrompt,
      userPrompt: `${userPrompt}\n\nYour first draft broke these house-style rules. Write it again, fixing every one:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
      temperature,
      usageAccountId: accountId,
    }),
    postprocessConfig,
  );
  const remaining = findCopyIssues(rewritten.copy);
  return {
    processed: {
      ...rewritten,
      warnings: [...rewritten.warnings, ...remaining.map((issue) => `House style: ${issue}`)],
    },
    temporal,
    temperature,
  };
}
