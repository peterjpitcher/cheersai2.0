import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

    return ok(history, request)
  } catch (error) {
    console.error("Error fetching prompt history:", error);
    return serverError('Failed to fetch prompt history', undefined, request)
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
        created_by: user.id
      });

    return ok(restoredPrompt, request)
  } catch (error) {
    console.error("Error restoring prompt version:", error);
    return serverError('Failed to restore prompt version', undefined, request)
  }
}
