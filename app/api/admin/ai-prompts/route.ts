import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { updateAIPromptSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { requireSuperadmin, SuperadminRequiredError } from '@/lib/security/superadmin'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

type PromptRow = Tables<'ai_platform_prompts'>

type PromptUpdateFields = TablesUpdate<'ai_platform_prompts'>

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    try {
      await requireSuperadmin()
    } catch (error) {
      if (error instanceof SuperadminRequiredError) {
        if (error.reason === 'unauthenticated') return unauthorized('Authentication required', undefined, request)
        if (error.reason === 'forbidden') return forbidden('Forbidden', undefined, request)
      }
      throw error
    }

    const supabase = await createClient()

    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform');
    const contentType = searchParams.get('contentType');

    let query = supabase
      .from('ai_platform_prompts')
      .select('*')
      .order('platform', { ascending: true })
      .order('content_type', { ascending: true })
      .order('created_at', { ascending: false })

    if (platform && platform !== 'all') {
      query = query.eq('platform', platform)
    }

    if (contentType && contentType !== 'all') {
      query = query.eq('content_type', contentType)
    }

    const { data: prompts, error } = await query.returns<PromptRow[]>()

    if (error) throw error

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
    let superadmin: Awaited<ReturnType<typeof requireSuperadmin>>
    try {
      superadmin = await requireSuperadmin()
    } catch (error) {
      if (error instanceof SuperadminRequiredError) {
        if (error.reason === 'unauthenticated') return unauthorized('Authentication required', undefined, request)
        if (error.reason === 'forbidden') return forbidden('Forbidden', undefined, request)
      }
      throw error
    }

    const supabase = await createClient()

    const raw = await request.json()
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
    type SnakeCreate = z.infer<typeof snakeCreate>

    const parsedSnake = snakeCreate.safeParse(raw)
    const parsedCamel = camelCreate.safeParse(raw)
    if (!parsedSnake.success && !parsedCamel.success) {
      const issue = parsedSnake.error || parsedCamel.error
      return badRequest('validation_error', 'Invalid prompt payload', issue.format(), request)
    }

    let snakePayload: SnakeCreate
    if (parsedSnake.success) {
      snakePayload = parsedSnake.data
    } else if (parsedCamel.success) {
      const camel = parsedCamel.data
      snakePayload = {
        name: camel.name,
        description: camel.description ?? undefined,
        platform: camel.platform,
        content_type: camel.contentType,
        system_prompt: camel.systemPrompt,
        user_prompt_template: camel.promptTemplate,
        temperature: camel.temperature ?? undefined,
        max_tokens: camel.maxTokens ?? undefined,
        is_active: camel.isActive ?? undefined,
        is_default: camel.isDefault ?? undefined,
      }
    } else {
      // Should never happen due to validation above
      throw new Error('Invalid prompt payload')
    }

    const mapped = {
      name: snakePayload.name,
      description: snakePayload.description ?? null,
      platform: snakePayload.platform,
      content_type: snakePayload.content_type,
      system_prompt: snakePayload.system_prompt,
      user_prompt_template: snakePayload.user_prompt_template,
      temperature: snakePayload.temperature ?? 0.8,
      max_tokens: snakePayload.max_tokens ?? 500,
      is_active: snakePayload.is_active ?? true,
      is_default: snakePayload.is_default ?? false,
    } satisfies TablesInsert<'ai_platform_prompts'>

    // If setting as default, unset existing default for this platform/content_type
    if (mapped.is_default) {
      await supabase
        .from("ai_platform_prompts")
        .update({ is_default: false })
        .eq("platform", mapped.platform)
        .eq("content_type", mapped.content_type)
    }

    const insertPayload = {
      ...mapped,
      created_by: superadmin.user.id,
    } satisfies TablesInsert<'ai_platform_prompts'>
    const { data: prompt, error } = await supabase
      .from('ai_platform_prompts')
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    reqLogger.info('AI prompt created', {
        area: 'admin',
        op: 'ai-prompts.create',
        status: 'ok',
        meta: { platform: mapped.platform, contentType: mapped.content_type },
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
    try {
      await requireSuperadmin()
    } catch (error) {
      if (error instanceof SuperadminRequiredError) {
        if (error.reason === 'unauthenticated') return unauthorized('Authentication required', undefined, request)
        if (error.reason === 'forbidden') return forbidden('Forbidden', undefined, request)
      }
      throw error
    }

    const supabase = await createClient()

    const raw = await request.json()
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
    type SnakeUpdate = z.infer<typeof snakeUpdate>

    const parsedSnakeU = snakeUpdate.safeParse(raw)
    const parsedCamelU = camelUpdate.safeParse(raw)
    if (!parsedSnakeU.success && !parsedCamelU.success) {
      const issue = parsedSnakeU.error || parsedCamelU.error
      return badRequest('validation_error', 'Invalid prompt update payload', issue.format(), request)
    }

    let snakeUpdatePayload: SnakeUpdate
    if (parsedSnakeU.success) {
      snakeUpdatePayload = parsedSnakeU.data
    } else if (parsedCamelU.success) {
      const camel = parsedCamelU.data
      snakeUpdatePayload = {
        id: camel.id,
        name: camel.name ?? undefined,
        description: camel.description ?? undefined,
        system_prompt: camel.systemPrompt ?? undefined,
        user_prompt_template: camel.promptTemplate ?? undefined,
        content_type: camel.contentType ?? undefined,
        temperature: camel.temperature ?? undefined,
        max_tokens: camel.maxTokens ?? undefined,
        is_active: camel.isActive ?? undefined,
        is_default: camel.isDefault ?? undefined,
      }
    } else {
      throw new Error('Invalid prompt update payload')
    }

    const normalizeUpdatePayload = (input: SnakeUpdate): { id: string; fields: PromptUpdateFields; setDefault?: boolean } => {
      const fields: PromptUpdateFields = { updated_at: new Date().toISOString() }

      if (typeof input.name !== 'undefined') fields.name = input.name
      if (typeof input.description !== 'undefined') fields.description = input.description
      if (typeof input.system_prompt !== 'undefined') fields.system_prompt = input.system_prompt
      if (typeof input.user_prompt_template !== 'undefined') fields.user_prompt_template = input.user_prompt_template
      if (typeof input.content_type !== 'undefined') fields.content_type = input.content_type
      if (typeof input.temperature !== 'undefined') fields.temperature = input.temperature
      if (typeof input.max_tokens !== 'undefined') fields.max_tokens = input.max_tokens
      if (typeof input.is_active !== 'undefined') fields.is_active = input.is_active

      let setDefault: boolean | undefined
      if (typeof input.is_default !== 'undefined') {
        fields.is_default = input.is_default
        setDefault = input.is_default ?? undefined
      }

      return { id: input.id, fields, setDefault }
    }

    const { id, fields, setDefault } = normalizeUpdatePayload(snakeUpdatePayload)

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
    if (setDefault === true) {
      await supabase
        .from("ai_platform_prompts")
        .update({ is_default: false })
        .eq("platform", existingPrompt.platform)
        .eq("content_type", existingPrompt.content_type)
        .neq("id", id);
    }

    const updatePayload = fields satisfies PromptUpdateFields

    const { data: prompt, error } = await supabase
      .from('ai_platform_prompts')
      .update(updatePayload)
      .eq('id', id)
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
    try {
      await requireSuperadmin()
    } catch (error) {
      if (error instanceof SuperadminRequiredError) {
        if (error.reason === 'unauthenticated') return unauthorized('Authentication required', undefined, request)
        if (error.reason === 'forbidden') return forbidden('Forbidden', undefined, request)
      }
      throw error
    }

    const supabase = await createClient();

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
