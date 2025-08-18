import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
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

    return NextResponse.json({ guardrails });
  } catch (error) {
    console.error("Error fetching guardrails:", error);
    return NextResponse.json(
      { error: "Failed to fetch guardrails" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      context_type,
      platform,
      feedback_type,
      feedback_text,
      original_content,
      original_prompt,
    } = body;

    // Validate required fields
    if (!context_type || !feedback_type || !feedback_text) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

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

    return NextResponse.json({ guardrail });
  } catch (error) {
    console.error("Error creating guardrail:", error);
    return NextResponse.json(
      { error: "Failed to create guardrail" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Guardrail ID required" },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from("content_guardrails")
      .select("tenant_id")
      .eq("id", id)
      .single();

    if (!existing || existing.tenant_id !== userData.tenant_id) {
      return NextResponse.json(
        { error: "Guardrail not found or unauthorized" },
        { status: 404 }
      );
    }

    const { data: guardrail, error } = await supabase
      .from("content_guardrails")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ guardrail });
  } catch (error) {
    console.error("Error updating guardrail:", error);
    return NextResponse.json(
      { error: "Failed to update guardrail" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Guardrail ID required" },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from("content_guardrails")
      .select("tenant_id")
      .eq("id", id)
      .single();

    if (!existing || existing.tenant_id !== userData.tenant_id) {
      return NextResponse.json(
        { error: "Guardrail not found or unauthorized" },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("content_guardrails")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting guardrail:", error);
    return NextResponse.json(
      { error: "Failed to delete guardrail" },
      { status: 500 }
    );
  }
}