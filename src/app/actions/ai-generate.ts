'use server';

/**
 * Server actions for AI content generation (AI-01, AI-02, AI-03).
 *
 * generateContent: generates platform-specific copy from a brief
 * regenerateWithModifier: regenerates with an appended instruction modifier
 */

import { unstable_rethrow } from 'next/navigation';

import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import { AI_OWNER_MESSAGES } from '@/lib/ai/generate';
import type { PostprocessResult } from '@/lib/ai/postprocess';
import { resolveCopyModel } from '@/lib/ai/models';
import { loadBrandProfile, loadMediaMetadata, writeCopy } from '@/lib/ai/write-copy';
import { requireEntitledContext } from '@/lib/billing/entitlement-server';
import { ownerMessage } from '@/lib/errors/owner-message';
import { createLogger } from '@/lib/logging';
import { toLoggableError } from '@/lib/logging/to-error';

const logger = createLogger('ai-generate');

const AI_OWNER_MESSAGE_SET = new Set<string>(Object.values(AI_OWNER_MESSAGES));

/**
 * What the create screen shows when generation fails: a message written for
 * owners as it is (plan on hold, AI timed out), otherwise plain words. OpenAI's
 * and the database's own text goes to the log (tasks/SPEC-plain-error-messages.md).
 */
function generationFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && AI_OWNER_MESSAGE_SET.has(error.message)) return error.message;
  return ownerMessage(error, fallback);
}

/**
 * Optional media + schedule context passed from the create wizard.
 *
 * Only mediaIds, scheduledAt and slotLabel are honoured. Every temporal fact is
 * derived on the server (writeCopy) from the brief plus scheduledAt, so one
 * clock and one implementation feed the prompt, the post-processor and the
 * stored generation params. The wizard no longer computes them in the browser.
 */
interface GenerationContextInput {
  mediaIds?: string[];
  scheduledAt?: string | null;
  slotLabel?: string; // e.g. "Event day", "2 weeks out", "Launch", "Week 3"
}

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
    const { supabase, accountId } = await requireEntitledContext('create');

    // Load the configured brand voice (key phrases, banned phrases, signatures,
    // tone sliders) from the brand_profile table, the same store the
    // Settings > Brand Voice form writes to.
    const brand = await loadBrandProfile(supabase, accountId);

    // Load media metadata for context-aware generation
    const mediaMetadata = await loadMediaMetadata(supabase, accountId, context?.mediaIds);

    const { processed, temporal, temperature } = await writeCopy({
      brief,
      brand,
      accountId,
      scheduledAt: context?.scheduledAt,
      slotLabel: context?.slotLabel,
      media: mediaMetadata,
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
            ...temporal,
            mediaMetadata: mediaMetadata.length > 0 ? mediaMetadata : undefined,
          },
          temperature,
          model: resolveCopyModel(),
        },
        body_draft: processed.copy,
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    return { data: processed };
  } catch (error) {
    unstable_rethrow(error);
    logger.error('generateContent failed', toLoggableError(error), { contentId });
    return { error: generationFailureMessage(error, 'We could not write the copy just now. Please try again.') };
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
    const { supabase, accountId } = await requireEntitledContext('create');

    // Load the configured brand voice, as generateContent does.
    const brand = await loadBrandProfile(supabase, accountId);

    // Load media metadata for context-aware generation
    const mediaMetadata = await loadMediaMetadata(supabase, accountId, context?.mediaIds);

    const { processed, temporal, temperature } = await writeCopy({
      brief,
      brand,
      accountId,
      scheduledAt: context?.scheduledAt,
      slotLabel: context?.slotLabel,
      media: mediaMetadata,
      modifier,
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
            ...temporal,
            mediaMetadata: mediaMetadata.length > 0 ? mediaMetadata : undefined,
          },
          temperature,
          model: resolveCopyModel(),
        },
        body_draft: processed.copy,
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    return { data: processed };
  } catch (error) {
    unstable_rethrow(error);
    logger.error('regenerateWithModifier failed', toLoggableError(error), { contentId });
    return { error: generationFailureMessage(error, 'We could not rewrite the copy just now. Please try again.') };
  }
}
