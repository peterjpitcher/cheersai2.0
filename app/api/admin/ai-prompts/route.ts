import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { updateAIPromptSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      return forbidden('Forbidden', undefined, request)
    }

    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform');
    const contentType = searchParams.get('contentType');

    let query = supabase
      .from("ai_platform_prompts")
      .select("*")
      .order("platform", { ascending: true })
      .order("content_type", { ascending: true })
      .order("created_at", { ascending: false });

    if (platform && platform !== 'all') {
      query = query.eq('platform', platform);
    }

    if (contentType && contentType !== 'all') {
      query = query.eq('content_type', contentType);
    }

    const { data: prompts, error } = await query;

    if (error) throw error;

    return ok(prompts, request)
  } catch (error) {
    console.error("Error fetching AI prompts:", error);
    return serverError('Failed to fetch AI prompts', undefined, request)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      return forbidden('Forbidden', undefined, request)
    }

    const raw = await request.json();
    const createSchema = z.object(updateAIPromptSchema.shape).extend({
      name: z.string().min(1),
      description: z.string().optional(),
      content_type: z.string().min(1),
      system_prompt: z.string().min(1),
      user_prompt_template: z.string().min(1),
      is_default: z.boolean().default(false)
    })
    const parsed = createSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid prompt payload', parsed.error.format(), request)
    }
    const { name, description, platform, content_type, system_prompt, user_prompt_template, is_active = true, is_default = false } = parsed.data

    // If setting as default, unset existing default for this platform/content_type
    if (is_default) {
      await supabase
        .from("ai_platform_prompts")
        .update({ is_default: false })
        .eq("platform", platform)
        .eq("content_type", content_type);
    }

    const { data: prompt, error } = await supabase
      .from("ai_platform_prompts")
      .insert({
        name,
        description,
        platform,
        content_type,
        system_prompt,
        user_prompt_template,
        is_active,
        is_default,
        created_by: user.id
      })
      .select()
      .single();

    if (error) throw error;

    return ok(prompt, request)
  } catch (error) {
    console.error("Error creating AI prompt:", error);
    return serverError('Failed to create AI prompt', undefined, request)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      return forbidden('Forbidden', undefined, request)
    }

    const raw = await request.json();
    const updateSchema = z.object({ id: z.string().uuid() }).and(z.object(updateAIPromptSchema.partial().shape)).extend({
      name: z.string().optional(),
      description: z.string().optional(),
      system_prompt: z.string().optional(),
      user_prompt_template: z.string().optional(),
      is_default: z.boolean().optional(),
    })
    const parsed = updateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid prompt update payload', parsed.error.format(), request)
    }
    const { id, name, description, system_prompt, user_prompt_template, is_active, is_default } = parsed.data as any

    // Get existing prompt to check platform/content_type for default logic
    const { data: existingPrompt } = await supabase
      .from("ai_platform_prompts")
      .select("platform, content_type")
      .eq("id", id)
      .single();

    if (!existingPrompt) {
      return notFound('Prompt not found', undefined, request)
    }

    // If setting as default, unset existing default for this platform/content_type
    if (is_default) {
      await supabase
        .from("ai_platform_prompts")
        .update({ is_default: false })
        .eq("platform", existingPrompt.platform)
        .eq("content_type", existingPrompt.content_type)
        .neq("id", id);
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (system_prompt !== undefined) updateData.system_prompt = system_prompt;
    if (user_prompt_template !== undefined) updateData.user_prompt_template = user_prompt_template;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (is_default !== undefined) updateData.is_default = is_default;

    const { data: prompt, error } = await supabase
      .from("ai_platform_prompts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return ok(prompt, request)
  } catch (error) {
    console.error("Error updating AI prompt:", error);
    return serverError('Failed to update AI prompt', undefined, request)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      return forbidden('Forbidden', undefined, request)
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return badRequest('validation_error', 'Missing prompt ID', undefined, request)
    }

    const { error } = await supabase
      .from("ai_platform_prompts")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return ok({ success: true }, request)
  } catch (error) {
    console.error("Error deleting AI prompt:", error);
    return serverError('Failed to delete AI prompt', undefined, request)
  }
}
