import { createLogger } from '@/lib/logging';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Per-brand AI usage log (SPEC-new-customer-readiness §4.6). Every OpenAI call
 * records one row so plan limits can be set from real use before any cap is
 * enforced. Recording never blocks or fails the AI call: a lost usage row is a
 * reporting gap, not a customer-facing failure.
 */
export type AiFeature = 'post_copy' | 'media_tagging' | 'campaign_generation' | 'campaign_copy_correction';

export interface AiUsageContext {
  accountId: string;
  feature: AiFeature;
}

interface UsageCarrier {
  model?: string | null;
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null;
}

const logger = createLogger('ai-usage');

export async function recordAiUsage(
  context: AiUsageContext,
  details: { model: string | null; promptTokens: number | null; completionTokens: number | null; succeeded: boolean },
): Promise<void> {
  try {
    const service = tryCreateServiceSupabaseClient();
    if (!service) return;
    const { error } = await service.from('ai_usage_events').insert({
      account_id: context.accountId,
      feature: context.feature,
      model: details.model,
      prompt_tokens: details.promptTokens,
      completion_tokens: details.completionTokens,
      succeeded: details.succeeded,
    });
    if (error) {
      logger.warn('ai usage insert failed', { accountId: context.accountId, feature: context.feature, reason: error.message });
    }
  } catch (error) {
    logger.warn('ai usage insert threw', {
      accountId: context.accountId,
      feature: context.feature,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Run one OpenAI call and record it against the brand. With no context (a
 * caller that has no brand, such as a script) the call runs unrecorded.
 */
export async function trackAiCall<T extends UsageCarrier>(
  context: AiUsageContext | undefined,
  requestedModel: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    const result = await call();
    if (context) {
      await recordAiUsage(context, {
        model: result.model ?? requestedModel,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        succeeded: true,
      });
    }
    return result;
  } catch (error) {
    if (context) {
      await recordAiUsage(context, { model: requestedModel, promptTokens: null, completionTokens: null, succeeded: false });
    }
    throw error;
  }
}
