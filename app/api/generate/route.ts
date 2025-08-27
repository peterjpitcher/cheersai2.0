import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createChatCompletion } from "@/lib/openai/client";
import { generatePostPrompt } from "@/lib/openai/prompts";
import { generateContentSchema } from "@/lib/validation/schemas";
import { withAuthValidation, errorResponse } from "@/lib/validation/middleware";

// Helper function to get AI platform prompt
async function getAIPlatformPrompt(supabase: any, platform: string, contentType: string) {
  const { data: customPrompt, error } = await supabase
    .from("ai_platform_prompts")
    .select("*")
    .eq("platform", platform)
    .eq("content_type", contentType)
    .eq("is_active", true)
    .eq("is_default", true)
    .single();

  if (error || !customPrompt) {
    // Fallback to general platform prompts
    const { data: generalPrompt } = await supabase
      .from("ai_platform_prompts")
      .select("*")
      .eq("platform", "general")
      .eq("content_type", contentType)
      .eq("is_active", true)
      .eq("is_default", true)
      .single();

    return generalPrompt;
  }

  return customPrompt;
}

export async function POST(request: NextRequest) {
  return withAuthValidation(request, generateContentSchema, async (validatedData, auth) => {
    try {
      const supabase = await createClient();
      const { user, tenantId } = auth;
      
      const { 
        platform,
        businessContext,
        tone,
        includeEmojis,
        includeHashtags,
        maxLength,
        prompt,
        eventDate,
        eventType,
        temperature
      } = validatedData;

    // Get brand profile with identity
    const { data: brandProfile } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    if (!brandProfile) {
      return NextResponse.json({ error: "No brand profile found" }, { status: 404 });
    }

    // Get tenant info
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    // Get brand voice profile if trained
    const { data: voiceProfile } = await supabase
      .from("brand_voice_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    // Get active guardrails
    const { data: guardrails } = await supabase
      .from("content_guardrails")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .or(`context_type.eq.campaign,context_type.eq.general`);

    // Get AI platform prompt if available
    const platformPrompt = await getAIPlatformPrompt(supabase, platform || "facebook", "post");
    
    // Generate content using OpenAI with reliability features
    
    let systemPrompt: string;
    let userPrompt: string;

    if (platformPrompt) {
      // Use custom AI prompt
      systemPrompt = platformPrompt.system_prompt;
      
      // Replace placeholders in user prompt template
      userPrompt = platformPrompt.user_prompt_template
        .replace(/\{eventType\}/g, eventType || 'general')
        .replace(/\{businessName\}/g, tenant.name)
        .replace(/\{businessType\}/g, brandProfile.business_type || "pub")
        .replace(/\{targetAudience\}/g, brandProfile.target_audience || "local community")
        .replace(/\{businessContext\}/g, businessContext || '')
        .replace(/\{eventDate\}/g, eventDate ? new Date(eventDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
    } else {
      // Build system prompt with brand identity
      systemPrompt = "You are a social media expert specializing in content for UK pubs and hospitality businesses.";
      
      // Create user prompt based on inputs
      let promptText = prompt || `Create a ${platform} post for ${tenant.name}, a ${brandProfile.business_type || 'pub'}.`;
      
      if (businessContext) {
        promptText += ` Context: ${businessContext}`;
      }
      
      if (eventType && eventDate) {
        const formattedDate = new Date(eventDate).toLocaleDateString('en-GB', { 
          weekday: 'long', 
          day: 'numeric', 
          month: 'long' 
        });
        promptText += ` We have a ${eventType} on ${formattedDate}.`;
      }
      
      promptText += ` Target audience: ${brandProfile.target_audience || 'local community'}.`;
      
      if (tone) {
        promptText += ` Tone should be ${tone}.`;
      }
      
      if (maxLength) {
        promptText += ` Keep it under ${maxLength} characters.`;
      }
      
      if (includeEmojis) {
        promptText += ' Include appropriate emojis.';
      }
      
      if (includeHashtags) {
        promptText += ' Include relevant hashtags.';
      }

      userPrompt = promptText;
    }
    
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
      
      // Update guardrail usage stats - use SQL to increment atomically
      const guardrailIds = guardrails.map(g => g.id);
      await supabase.rpc('increment_guardrails_usage', {
        guardrail_ids: guardrailIds
      }).throwOnError();
    }

    const completion = await createChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      temperature: temperature || 0.8,
      max_tokens: Math.min(maxLength || 500, 1000),
    });

    const generatedContent = completion.choices[0]?.message?.content || "";

    return NextResponse.json({ 
      content: generatedContent,
      platform: platform || 'facebook'
    });
    } catch (error) {
      console.error("Generation error:", error);
      
      // Provide user-friendly error messages based on error type
      if (error instanceof Error && error.message.includes('temporarily unavailable')) {
        return errorResponse(error.message, 503);
      }
      
      if (error instanceof Error && error.message.includes('rate_limit_exceeded')) {
        return errorResponse("AI service is currently busy. Please try again in a few moments.", 429);
      }
      
      if (error instanceof Error && error.message.includes('timeout')) {
        return errorResponse("Content generation timed out. Please try again.", 408);
      }
      
      return errorResponse("Failed to generate content. Please try again.", 500);
    }
  });
}