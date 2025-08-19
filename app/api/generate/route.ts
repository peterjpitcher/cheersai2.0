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
      eventDate,
      platform,
      customDate 
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

    // Get brand profile with identity
    const { data: brandProfile } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (!brandProfile) {
      return NextResponse.json({ error: "No brand profile found" }, { status: 404 });
    }

    // Get brand voice profile if trained
    const { data: voiceProfile } = await supabase
      .from("brand_voice_profiles")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    // Get active guardrails
    const { data: guardrails } = await supabase
      .from("content_guardrails")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .eq("is_active", true)
      .or(`context_type.eq.campaign,context_type.eq.general`);

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
      platform: platform || "facebook",
      customDate: customDate ? new Date(customDate) : undefined,
    });

    // Build system prompt with brand identity and voice profile
    let systemPrompt = "You are a social media expert specializing in content for UK pubs and hospitality businesses.";
    
    // Add brand identity if available
    if (brandProfile.brand_identity) {
      systemPrompt += `\n\nBrand Identity:
${brandProfile.brand_identity}

Use this brand identity to ensure all content is authentic and true to who we are.`;
    }
    
    if (voiceProfile) {
      systemPrompt += `\n\nBrand Voice Guidelines:
- Tone: ${voiceProfile.tone_attributes?.join(', ') || 'professional, friendly'}
- Key vocabulary: ${voiceProfile.vocabulary?.slice(0, 10).join(', ') || ''}
- Emoji usage: ${voiceProfile.emoji_usage ? `Yes (${voiceProfile.emoji_frequency})` : 'No'}
- Hashtag style: ${voiceProfile.hashtag_style || 'minimal'}
- Average sentence length: ${voiceProfile.avg_sentence_length || 15} words
- Writing characteristics: ${voiceProfile.characteristics?.join(', ') || ''}

Write in this exact style and voice.`;
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
      
      systemPrompt += "\n\nThese guardrails are mandatory and must be followed exactly.";
      
      // Update guardrail usage stats
      const guardrailIds = guardrails.map(g => g.id);
      await supabase
        .from("content_guardrails")
        .update({ 
          times_applied: guardrails[0].times_applied + 1,
          last_applied_at: new Date().toISOString()
        })
        .in("id", guardrailIds);
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt
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