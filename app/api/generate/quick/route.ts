import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt, tone } = await request.json();

    // Get user's brand profile for context
    const { data: userData } = await supabase
      .from("users")
      .select(`
        tenant_id,
        tenant:tenants (
          name
        )
      `)
      .eq("id", user.id)
      .single();

    const { data: brandProfile } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", userData?.tenant_id)
      .single();

    const businessName = brandProfile?.business_name || userData?.tenant?.name || "The Pub";
    const businessType = brandProfile?.business_type || "pub";

    // Generate content
    const systemPrompt = `You are a social media expert for ${businessType}s in the UK. 
Write engaging, friendly posts that drive foot traffic and create community engagement.
Keep posts concise (2-3 sentences max), use relevant emojis, and include a clear call-to-action.
UK English spelling only.`;

    const userPrompt = prompt || `Write a quick social media update for ${businessName}. 
Make it ${tone || "friendly and engaging"}. 
Focus on creating urgency or excitement about visiting today.
Examples: last-minute table availability, today's special, atmosphere update, etc.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 150,
    });

    const content = completion.choices[0]?.message?.content || "";

    return NextResponse.json({ content });
  } catch (error) {
    console.error("Quick post generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}