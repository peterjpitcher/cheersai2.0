import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIClient } from "@/lib/openai/client";
import { generatePostPrompt } from "@/lib/openai/prompts";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { 
      postTiming,
      campaignType,
      campaignName,
      eventDate 
    } = body;

    // Get user's tenant and brand info
    const { data: userData } = await supabase
      .from("users")
      .select(`
        tenant_id,
        tenants (
          id,
          name
        )
      `)
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id || !userData?.tenants) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    // Get brand profile
    const { data: brandProfile } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (!brandProfile) {
      return NextResponse.json({ error: "No brand profile found" }, { status: 404 });
    }

    // Generate content using OpenAI
    const openai = getOpenAIClient();
    
    const prompt = generatePostPrompt({
      campaignType,
      campaignName,
      businessName: userData.tenants.name,
      eventDate: new Date(eventDate),
      postTiming,
      toneAttributes: brandProfile.tone_attributes || ["friendly", "professional"],
      businessType: brandProfile.business_type || "pub",
      targetAudience: brandProfile.target_audience || "local community",
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a social media expert specializing in content for UK pubs and hospitality businesses."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    const generatedContent = completion.choices[0]?.message?.content || "";

    return NextResponse.json({ 
      content: generatedContent,
      postTiming 
    });
  } catch (error) {
    console.error("Generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}