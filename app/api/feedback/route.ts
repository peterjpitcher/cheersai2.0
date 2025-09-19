import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ok, badRequest, unauthorized, serverError } from '@/lib/http';
import { createRequestLogger, logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';

const feedbackSchema = z.object({
  content: z.string().min(1),
  prompt: z.string().optional().nullable(),
  platform: z.string().optional().nullable(),
  generationType: z.enum(['campaign', 'quick_post', 'caption', 'hashtags', 'other']),
  campaignId: z.string().optional().nullable(),
  postId: z.string().optional().nullable(),
  scope: z.enum(['platform', 'all']).default('all'),
  feedbackText: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request);
  try {
    const body = await request.json().catch(() => null);
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_feedback', 'Invalid feedback payload', parsed.error.format(), request);
    }

    const { content, prompt, platform, generationType, campaignId, postId, scope, feedbackText } = parsed.data;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request);
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!userRow?.tenant_id) {
      return badRequest('missing_tenant', 'User tenant not found', undefined, request);
    }

    const tenantId = userRow.tenant_id;

    const { data: feedback, error: feedbackError } = await supabase
      .from('ai_generation_feedback')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        campaign_id: campaignId || null,
        post_id: postId || null,
        generated_content: content,
        prompt_used: prompt || null,
        platform: platform || null,
        generation_type: generationType,
        feedback_type: 'needs_improvement',
        feedback_text: feedbackText,
        suggested_improvement: null,
      })
      .select('id')
      .single();

    if (feedbackError) {
      reqLogger.error('Failed to store feedback', {
        area: 'feedback',
        op: 'submit',
        status: 'fail',
        error: feedbackError,
      });
      return serverError('Failed to submit feedback', feedbackError.message, request);
    }

    const { data: guardrail, error: guardrailError } = await supabase
      .from('content_guardrails')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        context_type:
          generationType === 'campaign'
            ? 'campaign'
            : generationType === 'quick_post'
              ? 'quick_post'
              : 'general',
        platform: scope === 'platform' ? platform || null : null,
        feedback_type: 'avoid',
        feedback_text: feedbackText,
        original_content: content,
        original_prompt: prompt || null,
        is_active: true,
      })
      .select('id')
      .single();

    if (guardrailError) {
      reqLogger.error('Failed to create guardrail from feedback', {
        area: 'feedback',
        op: 'guardrail',
        status: 'fail',
        error: guardrailError,
        meta: { feedbackId: feedback?.id },
      });
      return serverError('Failed to create guardrail', guardrailError.message, request);
    }

    if (feedback && guardrail) {
      await supabase
        .from('ai_generation_feedback')
        .update({
          converted_to_guardrail: true,
          guardrail_id: guardrail.id,
        })
        .eq('id', feedback.id)
        .throwOnError();
    }

    reqLogger.info('Feedback submitted', {
      area: 'feedback',
      op: 'submit',
      status: 'ok',
      meta: { tenantId, userId: user.id, feedbackId: feedback?.id, guardrailId: guardrail?.id },
    });

    return ok({ success: true }, request);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    reqLogger.error('Unexpected feedback error', {
      area: 'feedback',
      op: 'submit',
      status: 'fail',
      error: err,
    });
    logger.error('Unexpected feedback error', {
      area: 'feedback',
      op: 'submit',
      status: 'fail',
      error: err,
    });
    return serverError('Internal server error', undefined, request);
  }
}
