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

    return NextResponse.json(prompts);
  } catch (error) {
    console.error("Error fetching AI prompts:", error);
    return NextResponse.json(
      { error: "Failed to fetch AI prompts" },
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
    const { 
      name, 
      description, 
      platform, 
      content_type,
      system_prompt,
      user_prompt_template,
      is_active = true,
      is_default = false
    } = body;

    // Validate required fields
    if (!name || !platform || !content_type || !system_prompt || !user_prompt_template) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

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

    return NextResponse.json(prompt);
  } catch (error) {
    console.error("Error creating AI prompt:", error);
    return NextResponse.json(
      { error: "Failed to create AI prompt" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
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
    const { 
      id,
      name, 
      description, 
      system_prompt,
      user_prompt_template,
      is_active,
      is_default
    } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Missing prompt ID" },
        { status: 400 }
      );
    }

    // Get existing prompt to check platform/content_type for default logic
    const { data: existingPrompt } = await supabase
      .from("ai_platform_prompts")
      .select("platform, content_type")
      .eq("id", id)
      .single();

    if (!existingPrompt) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
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

    return NextResponse.json(prompt);
  } catch (error) {
    console.error("Error updating AI prompt:", error);
    return NextResponse.json(
      { error: "Failed to update AI prompt" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
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
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: "Missing prompt ID" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("ai_platform_prompts")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting AI prompt:", error);
    return NextResponse.json(
      { error: "Failed to delete AI prompt" },
      { status: 500 }
    );
  }
}
