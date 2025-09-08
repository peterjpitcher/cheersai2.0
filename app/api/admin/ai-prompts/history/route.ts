import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const promptId = searchParams.get('promptId');

    if (!promptId) {
      return NextResponse.json(
        { error: "Missing prompt ID" },
        { status: 400 }
      );
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

    return NextResponse.json(history);
  } catch (error) {
    console.error("Error fetching prompt history:", error);
    return NextResponse.json(
      { error: "Failed to fetch prompt history" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and superadmin status
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { promptId, version, changeDescription } = body;

    if (!promptId || !version) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Get the historical version
    const { data: historyEntry, error: historyError } = await supabase
      .from("ai_platform_prompt_history")
      .select("*")
      .eq("prompt_id", promptId)
      .eq("version", version)
      .single();

    if (historyError || !historyEntry) {
      return NextResponse.json(
        { error: "Historical version not found" },
        { status: 404 }
      );
    }

    // Get current prompt for new version number
    const { data: currentPrompt, error: currentError } = await supabase
      .from("ai_platform_prompts")
      .select("version")
      .eq("id", promptId)
      .single();

    if (currentError || !currentPrompt) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
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

    return NextResponse.json(restoredPrompt);
  } catch (error) {
    console.error("Error restoring prompt version:", error);
    return NextResponse.json(
      { error: "Failed to restore prompt version" },
      { status: 500 }
    );
  }
}
