import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { updateContentGuardrailSchema } from '@/lib/validation/schemas'
import type { Json, TablesInsert, TablesUpdate } from '@/lib/database.types'
import { ok, badRequest, unauthorized, notFound, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }
    const tenantId = userData.tenant_id as string

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const contextType = searchParams.get("context_type");
    const platform = searchParams.get("platform");
    const isActive = searchParams.get("is_active");

    // Build query
    let query = supabase
      .from("content_guardrails")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (contextType) {
      query = query.eq("context_type", contextType);
    }
    if (platform) {
      query = query.eq("platform", platform);
    }
    if (isActive !== null) {
      query = query.eq("is_active", isActive === "true");
    }

    const { data: guardrails, error } = await query;

    if (error) throw error;

    return ok({ guardrails }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to fetch guardrails', {
      area: 'guardrails',
      op: 'list',
      status: 'fail',
      error: err,
    })
    logger.error('Guardrails GET failed', {
      area: 'guardrails',
      op: 'list',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to fetch guardrails', { message: err.message }, request)
  }
}

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }
    const tenantId = userData.tenant_id as string

    const raw = await request.json().catch(() => ({}));
    const createSchema = z.object(updateContentGuardrailSchema.shape).extend({
      context_type: z.enum(['campaign', 'general', 'quick_post']),
      feedback_type: z.enum(['avoid','include','tone','style','format']),
      platform: z.string().nullable().optional(),
      // Accept additional fields used for context linking
      feedback_text: z.string().max(500).optional(),
      original_content: z.string().optional(),
      original_prompt: z.string().optional(),
      // CamelCase aliases
      feedbackText: z.string().max(500).optional(),
      originalContent: z.string().optional(),
      originalPrompt: z.string().optional(),
    })
    const parsed = createSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid guardrail payload', parsed.error.format(), request)
    }
    const {
      context_type,
      platform,
      feedback_type,
      feedback_text,
      feedbackText,
      original_content,
      originalContent,
      original_prompt,
      originalPrompt,
    } = parsed.data
    const resolvedFeedbackText = feedback_text ?? feedbackText ?? null
    const resolvedOriginalContent = original_content ?? originalContent ?? null
    const resolvedOriginalPrompt = original_prompt ?? originalPrompt ?? null

    const insertPayload: TablesInsert<'content_guardrails'> = {
      tenant_id: tenantId,
      user_id: user.id,
      context_type,
      platform: platform ?? null,
      feedback_type,
      feedback_text: resolvedFeedbackText ?? '',
      original_content: resolvedOriginalContent,
      original_prompt: resolvedOriginalPrompt,
      is_active: true,
    }

    const { data: guardrail, error } = await supabase
      .from("content_guardrails")
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    return ok({ guardrail }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to create guardrail', {
      area: 'guardrails',
      op: 'create',
      status: 'fail',
      error: err,
    })
    logger.error('Guardrail creation failed', {
      area: 'guardrails',
      op: 'create',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to create guardrail', { message: err.message }, request)
  }
}

export async function PUT(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }
    const tenantId = userData.tenant_id as string

    const raw = await request.json().catch(() => ({}));
    const updateSchema = z.object({ id: z.string().uuid() }).and(z.object(updateContentGuardrailSchema.partial().shape))
    const parsed = updateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid update payload', parsed.error.format(), request)
    }
    const { id, ...updates } = parsed.data

    // Verify ownership
    const { data: existing } = await supabase
      .from("content_guardrails")
      .select("tenant_id, metadata")
      .eq("id", id)
      .single();

    if (!existing || existing.tenant_id !== tenantId) {
      return notFound('Guardrail not found or unauthorized', undefined, request)
    }

    const updatePayload: TablesUpdate<'content_guardrails'> = { updated_at: new Date().toISOString() }

    if (typeof updates.rule === 'string') {
      updatePayload.feedback_text = updates.rule
    }
    if (typeof updates.isActive === 'boolean') {
      updatePayload.is_active = updates.isActive
    }

    const metadataPatch: Record<string, unknown> = {}
    if (typeof updates.category === 'string') metadataPatch.category = updates.category
    if (typeof updates.severity === 'string') metadataPatch.severity = updates.severity
    if (typeof updates.action === 'string') metadataPatch.action = updates.action
    if (typeof updates.message === 'string') metadataPatch.message = updates.message

    if (Object.keys(metadataPatch).length > 0) {
      const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>
      updatePayload.metadata = { ...existingMetadata, ...metadataPatch } as Json
    }

    const { data: guardrail, error } = await supabase
      .from("content_guardrails")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return ok({ guardrail }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to update guardrail', {
      area: 'guardrails',
      op: 'update',
      status: 'fail',
      error: err,
    })
    logger.error('Guardrail update failed', {
      area: 'guardrails',
      op: 'update',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to update guardrail', { message: err.message }, request)
  }
}

export async function DELETE(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }
    const tenantId = userData.tenant_id as string

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    if (!id) {
      return badRequest('validation_error', 'Guardrail ID required', undefined, request)
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from("content_guardrails")
      .select("tenant_id")
      .eq("id", id)
      .single();

    if (!existing || existing.tenant_id !== tenantId) {
      return notFound('Guardrail not found or unauthorized', undefined, request)
    }

    const { error } = await supabase
      .from("content_guardrails")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return ok({ success: true }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to delete guardrail', {
      area: 'guardrails',
      op: 'delete',
      status: 'fail',
      error: err,
    })
    logger.error('Guardrail deletion failed', {
      area: 'guardrails',
      op: 'delete',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to delete guardrail', { message: err.message }, request)
  }
}
