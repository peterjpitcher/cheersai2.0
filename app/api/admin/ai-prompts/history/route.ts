import { NextRequest } from "next/server";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { createClient } from "@/lib/supabase/server";
import { requireSuperadmin, SuperadminRequiredError } from '@/lib/security/superadmin'

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

    const supabase = await createClient();

    const { searchParams } = new URL(request.url);
    const promptId = searchParams.get('promptId');

    if (!promptId) {
      return badRequest('validation_error', 'Missing prompt ID', undefined, request)
    }

    const { data: history, error } = await supabase
      .from("ai_platform_prompt_history")
      .select(`
        *,
        created_by_user:created_by(email)
      `)
      .eq("prompt_id", promptId)
      .order("version", { ascending: false });

    if (error) throw error;

    reqLogger.info('AI prompt history fetched', {
      area: 'admin',
      op: 'ai-prompts.history.list',
      status: 'ok',
      meta: { promptId },
    })
    return ok(history, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error fetching prompt history', {
      area: 'admin',
      op: 'ai-prompts.history.list',
      status: 'fail',
      error: err,
    })
    logger.error('Error fetching prompt history', {
      area: 'admin',
      op: 'ai-prompts.history.list',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to fetch prompt history', undefined, request)
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

    const supabase = await createClient();

    const body = await request.json();
    const { promptId, version, changeDescription } = body;

    if (!promptId || !version) {
      return badRequest('validation_error', 'Missing required fields', undefined, request)
    }

    // Get the historical version
    const { data: historyEntry, error: historyError } = await supabase
      .from("ai_platform_prompt_history")
      .select("*")
      .eq("prompt_id", promptId)
      .eq("version", version)
      .single();

    if (historyError || !historyEntry) {
      return notFound('Historical version not found', undefined, request)
    }

    // Get current prompt for new version number
    const { data: currentPrompt, error: currentError } = await supabase
      .from("ai_platform_prompts")
      .select("version")
      .eq("id", promptId)
      .single();

    if (currentError || !currentPrompt) {
      return notFound('Prompt not found', undefined, request)
    }

    // Restore the prompt to the historical version
    const { data: restoredPrompt, error: restoreError } = await supabase
      .from("ai_platform_prompts")
      .update({
        system_prompt: historyEntry.system_prompt,
        user_prompt_template: historyEntry.user_prompt_template,
        version: currentPrompt.version + 1,
        updated_at: new Date().toISOString()
      })
      .eq("id", promptId)
      .select()
      .single();

    if (restoreError) throw restoreError;

    // Add a history entry for the restore action
    await supabase
      .from("ai_platform_prompt_history")
      .insert({
        prompt_id: promptId,
        version: currentPrompt.version + 1,
        system_prompt: historyEntry.system_prompt,
        user_prompt_template: historyEntry.user_prompt_template,
        change_description: changeDescription || `Restored to version ${version}`,
        created_by: superadmin.user.id,
      });

    reqLogger.info('AI prompt version restored', {
      area: 'admin',
      op: 'ai-prompts.history.restore',
      status: 'ok',
      meta: { promptId, version, restoredBy: superadmin.user.id },
    })

    return ok(restoredPrompt, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error restoring prompt version', {
      area: 'admin',
      op: 'ai-prompts.history.restore',
      status: 'fail',
      error: err,
    })
    logger.error('Error restoring prompt version', {
      area: 'admin',
      op: 'ai-prompts.history.restore',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to restore prompt version', undefined, request)
  }
}
