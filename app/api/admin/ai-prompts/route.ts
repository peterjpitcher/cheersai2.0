import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { updateAIPromptSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const SUPERADMINS = [
      'peter.pitcher@outlook.com'
    ]
    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin, email")
      .eq("id", user.id)
      .single();

    const emailOk = (userData?.email || user.email || '').toLowerCase() === 'peter.pitcher@outlook.com'
    if (!userData?.is_superadmin && !emailOk) {
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

    reqLogger.info('AI prompts fetched', {
      area: 'admin',
      op: 'ai-prompts.list',
      status: 'ok',
      meta: { count: prompts?.length || 0 },
    })
    return ok(prompts, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error fetching AI prompts', {
      area: 'admin',
      op: 'ai-prompts.list',
      status: 'fail',
      error: err,
    })
    logger.error('Error fetching AI prompts', {
      area: 'admin',
      op: 'ai-prompts.list',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to fetch AI prompts', undefined, request)
  }
}

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin, email")
      .eq("id", user.id)
      .single();

    const emailOk = (userData?.email || user.email || '').toLowerCase() === 'peter.pitcher@outlook.com'
    if (!userData?.is_superadmin && !emailOk) {
      return forbidden('Forbidden', undefined, request)
    }

    const raw = await request.json();
    // Accept both camelCase (UI) and snake_case (DB) payloads
    const snakeCreate = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      platform: updateAIPromptSchema.shape.platform,
      content_type: z.string().min(1),
      system_prompt: z.string().min(1),
      user_prompt_template: z.string().min(1),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().min(10).max(4000).optional(),
      is_active: z.boolean().optional(),
      is_default: z.boolean().optional(),
    })
    const camelCreate = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      platform: updateAIPromptSchema.shape.platform,
      contentType: z.string().min(1),
      systemPrompt: z.string().min(1),
      promptTemplate: z.string().min(1),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(10).max(4000).optional(),
      isActive: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    })
    const parsedSnake = snakeCreate.safeParse(raw)
    const parsedCamel = camelCreate.safeParse(raw)
    if (!parsedSnake.success && !parsedCamel.success) {
      const issue = parsedSnake.error || parsedCamel.error
      return badRequest('validation_error', 'Invalid prompt payload', issue.format(), request)
    }
    const data: any = parsedSnake.success ? parsedSnake.data : (parsedCamel as any).data
    const mapped = parsedSnake.success ? {
      name: data.name,
      description: data.description,
      platform: data.platform,
      content_type: data.content_type,
      system_prompt: data.system_prompt,
      user_prompt_template: data.user_prompt_template,
      temperature: data.temperature ?? 0.8,
      max_tokens: data.max_tokens ?? 500,
      is_active: data.is_active ?? true,
      is_default: data.is_default ?? false,
    } : {
      name: (data as any).name,
      description: (data as any).description,
      platform: (data as any).platform,
      content_type: (data as any).contentType,
      system_prompt: (data as any).systemPrompt,
      user_prompt_template: (data as any).promptTemplate,
      temperature: (data as any).temperature ?? 0.8,
      max_tokens: (data as any).maxTokens ?? 500,
      is_active: (data as any).isActive ?? true,
      is_default: (data as any).isDefault ?? false,
    }
    const { name, description, platform, content_type, system_prompt, user_prompt_template, is_active, is_default, temperature, max_tokens } = mapped as any

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
        temperature,
        max_tokens,
        is_active,
        is_default,
        created_by: user.id
      })
      .select()
      .single();

    if (error) throw error;

    reqLogger.info('AI prompt created', {
      area: 'admin',
      op: 'ai-prompts.create',
      status: 'ok',
      meta: { platform, content_type },
    })

    return ok(prompt, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error creating AI prompt', {
      area: 'admin',
      op: 'ai-prompts.create',
      status: 'fail',
      error: err,
    })
    logger.error('Error creating AI prompt', {
      area: 'admin',
      op: 'ai-prompts.create',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to create AI prompt', undefined, request)
  }
}

export async function PUT(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin, email")
      .eq("id", user.id)
      .single();

    const emailOk = (userData?.email || user.email || '').toLowerCase() === 'peter.pitcher@outlook.com'
    if (!userData?.is_superadmin && !emailOk) {
      return forbidden('Forbidden', undefined, request)
    }

    const raw = await request.json();
    // Similar dual-schema approach for updates
    const snakeUpdate = z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      system_prompt: z.string().optional(),
      user_prompt_template: z.string().optional(),
      content_type: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().min(10).max(4000).optional(),
      is_active: z.boolean().optional(),
      is_default: z.boolean().optional(),
    })
    const camelUpdate = z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      systemPrompt: z.string().optional(),
      promptTemplate: z.string().optional(),
      contentType: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(10).max(4000).optional(),
      isActive: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    })
    const parsedSnakeU = snakeUpdate.safeParse(raw)
    const parsedCamelU = camelUpdate.safeParse(raw)
    if (!parsedSnakeU.success && !parsedCamelU.success) {
      const issue = parsedSnakeU.error || parsedCamelU.error
      return badRequest('validation_error', 'Invalid prompt update payload', issue.format(), request)
    }
    const dataU: any = parsedSnakeU.success ? parsedSnakeU.data : (parsedCamelU as any).data
    const { id } = dataU as any

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
    const is_default = (dataU as any).is_default ?? (dataU as any).isDefault
    if (is_default) {
      await supabase
        .from("ai_platform_prompts")
        .update({ is_default: false })
        .eq("platform", existingPrompt.platform)
        .eq("content_type", existingPrompt.content_type)
        .neq("id", id);
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    const up: any = dataU;
    if (up.name !== undefined) updateData.name = up.name;
    if (up.description !== undefined) updateData.description = up.description;
    if (up.system_prompt !== undefined) updateData.system_prompt = up.system_prompt;
    if (up.user_prompt_template !== undefined) updateData.user_prompt_template = up.user_prompt_template;
    if (up.systemPrompt !== undefined) updateData.system_prompt = up.systemPrompt;
    if (up.promptTemplate !== undefined) updateData.user_prompt_template = up.promptTemplate;
    if (up.content_type !== undefined) updateData.content_type = up.content_type;
    if (up.contentType !== undefined) updateData.content_type = up.contentType;
    if (up.temperature !== undefined) updateData.temperature = up.temperature;
    if (up.max_tokens !== undefined) updateData.max_tokens = up.max_tokens;
    if (up.maxTokens !== undefined) updateData.max_tokens = up.maxTokens;
    if (up.is_active !== undefined) updateData.is_active = up.is_active;
    if (up.isActive !== undefined) updateData.is_active = up.isActive;
    if (is_default !== undefined) updateData.is_default = is_default;

    const { data: prompt, error } = await supabase
      .from("ai_platform_prompts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    reqLogger.info('AI prompt updated', {
      area: 'admin',
      op: 'ai-prompts.update',
      status: 'ok',
      meta: { id },
    })

    return ok(prompt, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error updating AI prompt', {
      area: 'admin',
      op: 'ai-prompts.update',
      status: 'fail',
      error: err,
    })
    logger.error('Error updating AI prompt', {
      area: 'admin',
      op: 'ai-prompts.update',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to update AI prompt', undefined, request)
  }
}

export async function DELETE(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin, email")
      .eq("id", user.id)
      .single();

    const emailOk = (userData?.email || user.email || '').toLowerCase() === 'peter.pitcher@outlook.com'
    if (!userData?.is_superadmin && !emailOk) {
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

    reqLogger.info('AI prompt deleted', {
      area: 'admin',
      op: 'ai-prompts.delete',
      status: 'ok',
      meta: { id },
    })

    return ok({ success: true }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error deleting AI prompt', {
      area: 'admin',
      op: 'ai-prompts.delete',
      status: 'fail',
      error: err,
    })
    logger.error('Error deleting AI prompt', {
      area: 'admin',
      op: 'ai-prompts.delete',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to delete AI prompt', undefined, request)
  }
}
