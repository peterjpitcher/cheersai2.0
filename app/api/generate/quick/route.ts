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

    const { prompt, tone, platforms } = await request.json();

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

    // Get active guardrails for quick posts
    const { data: guardrails } = await supabase
      .from("content_guardrails")
      .select("*")
      .eq("tenant_id", userData?.tenant_id)
      .eq("is_active", true)
      .or(`context_type.eq.quick_post,context_type.eq.general`);

    const businessName = brandProfile?.business_name || userData?.tenant?.name || "The Pub";
    const businessType = brandProfile?.business_type || "pub";

    // Generate content with brand identity
    let systemPrompt = `You are a social media expert for ${businessType}s in the UK. 
Write engaging, friendly posts that drive foot traffic and create community engagement.
Keep posts concise (2-3 sentences max), use relevant emojis, and include a clear call-to-action.

IMPORTANT: Always use British English spelling and UK terminology:
- Use: customise, analyse, organise, realise, optimise, specialise, recognise, maximise, minimise, summarise
- NOT: customize, analyze, organize, realize, optimize, specialize, recognize, maximize, minimize, summarize
- Use: colour, favour, behaviour, honour, centre, theatre, cancelled, modelled
- NOT: color, favor, behavior, honor, center, theater, canceled, modeled
- Use British idioms and expressions appropriate for UK hospitality businesses.`;

    // Add brand identity if available
    if (brandProfile?.brand_identity) {
      systemPrompt += `\n\nBrand Identity:
${brandProfile.brand_identity}

Ensure all content reflects this brand identity and stays true to who we are.`;
    }

    // Add guardrails to system prompt
    if (guardrails && guardrails.length > 0) {
      systemPrompt += "\n\nContent Guardrails (MUST follow these rules):";
      
      const avoidRules = guardrails.filter(g => g.feedback_type === 'avoid');
      const includeRules = guardrails.filter(g => g.feedback_type === 'include');
      const toneRules = guardrails.filter(g => g.feedback_type === 'tone');
      const styleRules = guardrails.filter(g => g.feedback_type === 'style');
      const formatRules = guardrails.filter(g => g.feedback_type === 'format');
      
      if (avoidRules.length > 0) {
        systemPrompt += "\n\nTHINGS TO AVOID:";
        avoidRules.forEach(rule => {
          systemPrompt += `\n- ${rule.feedback_text}`;
        });
      }
      
      if (includeRules.length > 0) {
        systemPrompt += "\n\nTHINGS TO INCLUDE:";
        includeRules.forEach(rule => {
          systemPrompt += `\n- ${rule.feedback_text}`;
        });
      }
      
      if (toneRules.length > 0) {
        systemPrompt += "\n\nTONE REQUIREMENTS:";
        toneRules.forEach(rule => {
          systemPrompt += `\n- ${rule.feedback_text}`;
        });
      }
      
      if (styleRules.length > 0) {
        systemPrompt += "\n\nSTYLE REQUIREMENTS:";
        styleRules.forEach(rule => {
          systemPrompt += `\n- ${rule.feedback_text}`;
        });
      }
      
      if (formatRules.length > 0) {
        systemPrompt += "\n\nFORMAT REQUIREMENTS:";
        formatRules.forEach(rule => {
          systemPrompt += `\n- ${rule.feedback_text}`;
        });
      }
      
      // Update guardrail usage stats - use SQL to increment atomically
      const guardrailIds = guardrails.map(g => g.id);
      await supabase.rpc('increment_guardrails_usage', {
        guardrail_ids: guardrailIds
      }).throwOnError();
    }

    const baseUserPrompt = (platform: string) => {
      // Platform-specific link instruction + style
      const linkInstruction =
        platform === 'instagram_business'
          ? "Do not include raw URLs. Refer to the profile link using the phrase 'link in bio'."
          : platform === 'google_my_business'
            ? "Do not paste URLs in the text. Refer to 'click the link below' because the post includes a separate CTA button."
            : "Include the URL inline once as a plain URL (no tracking parameters).";

      const platformName = platform === 'instagram_business' ? 'Instagram' : (platform === 'google_my_business' ? 'Google My Business' : platform);

      return (
`Write a quick ${platformName} update for ${businessName}. Make it ${tone || 'friendly and engaging'}.
Focus on creating urgency or excitement about visiting today.
If a time is mentioned, use 12-hour style with lowercase am/pm (e.g., 7pm, 8:30pm) — never 24-hour.
Link handling: ${linkInstruction}

Inspiration/context: ${prompt || 'general daily update'}`);
    };

    const targetPlatforms: string[] = Array.isArray(platforms) && platforms.length > 0 ? platforms : ['facebook'];
    const contents: Record<string, string> = {};

    for (const p of targetPlatforms) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: baseUserPrompt(p) }
        ],
        temperature: 0.8,
        max_tokens: 220,
      });
      contents[p] = completion.choices[0]?.message?.content || "";
    }

    return NextResponse.json({ contents });
  } catch (error) {
    console.error("Quick post generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}
