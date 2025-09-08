import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIClient } from "@/lib/openai/client";
import { generatePostPrompt } from "@/lib/openai/prompts";
import { z } from 'zod'
import { generateContentSchema } from '@/lib/validation/schemas'
import { unauthorized, notFound, ok, serverError } from '@/lib/http'

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

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const raw = await request.json();
    const _validated = z.object(generateContentSchema.shape).partial().safeParse(raw)
    // We don't strictly enforce all fields here due to multiple generation modes,
    // but parsing catches obvious type errors early.
    const { 
      campaignId,
      postTiming,
      campaignType,
      campaignName,
      eventDate,
      platform,
      businessContext,
      tone,
      includeEmojis,
      includeHashtags,
      businessType,
      businessDescription,
      cuisineType,
      atmosphere,
      currentOffers,
      weeklyFeatures,
      upcomingEvents,
      customDate,
      prompt,
      maxLength
    } = body;

    // Get user's tenant ID
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }

    const tenantId = userData.tenant_id;

    // Get brand profile with identity
    const { data: brandProfile } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    if (!brandProfile) {
      return notFound('No brand profile found', undefined, request)
    }

    // Get tenant info
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();

    if (!tenant) {
      return notFound('No tenant found', undefined, request)
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

    // Load campaign for creative brief, if provided
    let campaignBrief: string | null = null;
    if (campaignId) {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('description')
        .eq('id', campaignId)
        .single();
      if (campaign?.description) campaignBrief = campaign.description;
    }

    if (platformPrompt) {
      // Use custom AI prompt
      systemPrompt = platformPrompt.system_prompt;
      
      // Replace placeholders in user prompt template
      userPrompt = platformPrompt.user_prompt_template
        .replace(/\{eventType\}/g, campaignType || 'general')
        .replace(/\{businessName\}/g, tenant.name)
        .replace(/\{businessType\}/g, brandProfile.business_type || "pub")
        .replace(/\{targetAudience\}/g, brandProfile.target_audience || "local community")
        .replace(/\{businessContext\}/g, businessContext || '')
        .replace(/\{eventDate\}/g, eventDate ? formatDate(eventDate, undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '');
    } else {
      // Build system prompt with brand identity
      systemPrompt = "You are a social media expert specialising in content for UK pubs and hospitality businesses. Always use British English spelling and UK terminology (e.g., customise NOT customize, analyse NOT analyze, colour NOT color, centre NOT center, organise NOT organize, realise NOT realize, favourite NOT favorite, optimised NOT optimized, specialising NOT specializing, cancelled NOT canceled).";
      
      // Use the generatePostPrompt function if we have the necessary data
      if (postTiming && campaignType && campaignName && eventDate) {
        userPrompt = generatePostPrompt({
          campaignType,
          campaignName,
          businessName: tenant.name,
          eventDate: new Date(eventDate),
          postTiming: postTiming as any,
          toneAttributes: tone ? [tone] : ['friendly', 'welcoming'],
          businessType: brandProfile.business_type || 'pub',
          targetAudience: brandProfile.target_audience || 'local community',
          platform: platform || 'facebook',
          customDate: customDate ? new Date(customDate) : undefined
        });
        if (campaignBrief) {
          userPrompt += `\n\nCreative brief from user:\n${campaignBrief}`;
        }
      } else {
        // Fallback to simple prompt
        let promptText = prompt || `Create a ${platform || 'social media'} post for ${tenant.name}, a ${brandProfile.business_type || 'pub'}.`;
        
        if (businessContext) {
          promptText += ` Context: ${businessContext}`;
        }
        if (campaignBrief) {
          promptText += ` Creative brief: ${campaignBrief}.`;
        }
        
        if (campaignType && eventDate) {
          const formattedDate = formatDate(eventDate, undefined, { weekday: 'long', day: 'numeric', month: 'long' });
          const time12 = formatTime(eventDate).replace(/:00(?=[ap]m$)/, '');
          promptText += ` We have a ${campaignType} on ${formattedDate}${time12 ? ` at ${time12}` : ''}.`;
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

        // Add platform-specific link instruction in fallback
        const linkInstruction =
          (platform || 'facebook') === 'instagram_business'
            ? " Do not include raw URLs; say 'link in bio'."
            : (platform || 'facebook') === 'google_my_business'
              ? " Do not paste URLs in the text; refer to 'click the link below' because the CTA button holds the link."
              : " Include the URL inline once as a plain URL.";

        userPrompt = `${promptText}${linkInstruction}`;
      }
    }
    
    // Add business details (contact, links, opening hours)
    const { formatUkPhoneDisplay } = await import('@/lib/utils/format');
    const phoneDisplay = brandProfile.phone_e164 ? formatUkPhoneDisplay(brandProfile.phone_e164) : '';
    const whatsappDisplay = brandProfile.whatsapp_e164 ? formatUkPhoneDisplay(brandProfile.whatsapp_e164) : '';

    const openingLines: string[] = [];
    if (brandProfile.opening_hours && typeof brandProfile.opening_hours === 'object') {
      const days = ['mon','tue','wed','thu','fri','sat','sun'] as const;
      const dayNames: Record<string,string> = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
      for (const d of days) {
        const info: any = (brandProfile.opening_hours as any)[d];
        if (!info) continue;
        if (info.closed) openingLines.push(`${dayNames[d]}: Closed`);
        else if (info.open && info.close) openingLines.push(`${dayNames[d]}: ${info.open}–${info.close}`);
      }
      // Add today's hours (respect exceptions)
      try {
        const today = new Date();
        const yyyy = today.toISOString().split('T')[0];
        const dn = formatDate(today, undefined, { weekday: 'short' });
        const ex = Array.isArray((brandProfile.opening_hours as any).exceptions)
          ? (brandProfile.opening_hours as any).exceptions.find((e: any) => e.date === yyyy)
          : null;
        const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][today.getDay()];
        let todayLine = '';
        if (ex) todayLine = ex.closed ? 'Closed' : (ex.open && ex.close ? `${ex.open}–${ex.close}` : '');
        else if ((brandProfile.opening_hours as any)[dayKey]) {
          const base = (brandProfile.opening_hours as any)[dayKey];
          todayLine = base.closed ? 'Closed' : (base.open && base.close ? `${base.open}–${base.close}` : '');
        }
        if (todayLine) systemPrompt += `\n- Today (${dn}): ${todayLine}`;
      } catch {}
      // Add event date hours if applicable
      try {
        if (eventDate) {
          const d = new Date(eventDate);
          const yyyy = d.toISOString().split('T')[0];
          const dn = formatDate(d, undefined, { weekday: 'short', day: 'numeric', month: 'short' });
          const ex = Array.isArray((brandProfile.opening_hours as any).exceptions)
            ? (brandProfile.opening_hours as any).exceptions.find((e: any) => e.date === yyyy)
            : null;
          const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
          let line = '';
          if (ex) line = ex.closed ? 'Closed' : (ex.open && ex.close ? `${ex.open}–${ex.close}` : '');
          else if ((brandProfile.opening_hours as any)[dayKey]) {
            const base = (brandProfile.opening_hours as any)[dayKey];
            line = base.closed ? 'Closed' : (base.open && base.close ? `${base.open}–${base.close}` : '');
          }
          if (line) systemPrompt += `\n- ${dn}: ${line}`;
        }
      } catch {}
    }

    systemPrompt += "\n\nBusiness Details:";
    if (brandProfile.website_url) systemPrompt += `\n- Website: ${brandProfile.website_url}`;
    if (brandProfile.booking_url) systemPrompt += `\n- Booking: ${brandProfile.booking_url}`;
    if (phoneDisplay) systemPrompt += `\n- Phone: ${phoneDisplay}`;
    if (whatsappDisplay) systemPrompt += `\n- WhatsApp: ${whatsappDisplay}`;
    if (openingLines.length > 0) systemPrompt += `\n- Opening hours:\n  ${openingLines.join('\n  ')}`;
    systemPrompt += "\nInclude opening hours in a natural way when promoting visits: if the post is for today or not date-specific, include a short line like 'Open today HH–HH' using today's hours; if clearly for a future day, you may include 'Open {Weekday} HH–HH' for that day. If hours not known for that day, omit.";

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

    // Always instruct 12-hour time format with lowercase am/pm and platform CTA nuances
    systemPrompt += "\n\nTime formatting: Use 12-hour times with lowercase am/pm and no leading zeros (e.g., 7pm, 8:30pm). Never use 24-hour times.";
    systemPrompt += "\nCTA formatting: On Instagram, never include raw URLs; use 'link in bio'. On Google Business Profile, do not paste URLs in text; refer to 'click the link below'. On Facebook and others, include the booking or website URL once if relevant. If a phone number is included, use UK national format (no +44).";

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
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
      temperature: 0.8,
      max_tokens: 500,
    });

    const generatedContent = completion.choices[0]?.message?.content || "";

    return ok({ content: generatedContent, platform: platform || 'facebook' }, request)
  } catch (error) {
    console.error('Generate error:', error);
    return serverError('Failed to generate content. Please try again.', undefined, request)
  }
}
