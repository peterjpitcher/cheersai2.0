import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { updateContentGuardrailSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, notFound, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
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

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const contextType = searchParams.get("context_type");
    const platform = searchParams.get("platform");
    const isActive = searchParams.get("is_active");

    // Build query
    let query = supabase
      .from("content_guardrails")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
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
    console.error("Error fetching guardrails:", error);
    return serverError('Failed to fetch guardrails', undefined, request)
  }
}

export async function POST(request: NextRequest) {
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

    const raw = await request.json();
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
    const { context_type, platform, feedback_type } = parsed.data as any
    const feedback_text = (parsed.data as any).feedback_text ?? (parsed.data as any).feedbackText
    const original_content = (parsed.data as any).original_content ?? (parsed.data as any).originalContent
    const original_prompt = (parsed.data as any).original_prompt ?? (parsed.data as any).originalPrompt

    const { data: guardrail, error } = await supabase
      .from("content_guardrails")
      .insert({
        tenant_id: userData.tenant_id,
        user_id: user.id,
        context_type,
        platform: platform || null,
        feedback_type,
        feedback_text,
        original_content: original_content || null,
        original_prompt: original_prompt || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return ok({ guardrail }, request)
  } catch (error) {
    console.error("Error creating guardrail:", error);
    return serverError('Failed to create guardrail', undefined, request)
  }
}

export async function PUT(request: NextRequest) {
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

    const raw = await request.json();
    const updateSchema = z.object({ id: z.string().uuid() }).and(z.object(updateContentGuardrailSchema.partial().shape))
    const parsed = updateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid update payload', parsed.error.format(), request)
    }
    const { id, ...updates } = parsed.data as any

    // Verify ownership
    const { data: existing } = await supabase
      .from("content_guardrails")
      .select("tenant_id")
      .eq("id", id)
      .single();

    if (!existing || existing.tenant_id !== userData.tenant_id) {
      return notFound('Guardrail not found or unauthorized', undefined, request)
    }

    const { data: guardrail, error } = await supabase
      .from("content_guardrails")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return ok({ guardrail }, request)
  } catch (error) {
    console.error("Error updating guardrail:", error);
    return serverError('Failed to update guardrail', undefined, request)
  }
}

export async function DELETE(request: NextRequest) {
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

    if (!existing || existing.tenant_id !== userData.tenant_id) {
      return notFound('Guardrail not found or unauthorized', undefined, request)
    }

    const { error } = await supabase
      .from("content_guardrails")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return ok({ success: true }, request)
  } catch (error) {
    console.error("Error deleting guardrail:", error);
    return serverError('Failed to delete guardrail', undefined, request)
  }
}
