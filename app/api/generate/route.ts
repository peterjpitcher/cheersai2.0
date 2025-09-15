import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/datetime";
import { getOpenAIClient } from "@/lib/openai/client";
import { generatePostPrompt } from "@/lib/openai/prompts";
import { z } from 'zod'
import { generateContentSchema } from '@/lib/validation/schemas'
import { unauthorized, notFound, ok, serverError, rateLimited } from '@/lib/http'
import { preflight } from '@/lib/preflight'
import { enforcePlatformLimits } from '@/lib/utils/text'
import { enforceUserAndTenantLimits } from '@/lib/rate-limit'
import { checkTenantBudget, incrementUsage } from '@/lib/usage'
import { createRequestLogger } from '@/lib/observability/logger'
import { safeLog } from '@/lib/scrub'

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
    const reqLogger = createRequestLogger(request as unknown as Request)
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const raw = await request.json();
    const body: any = raw;
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

    // Rate limit AI generation per user and tenant (looser in development)
    const dev = process.env.NODE_ENV !== 'production'
    const { user: userLimit, tenant: tenantLimit } = await enforceUserAndTenantLimits({
      userId: user.id,
      tenantId: tenantId,
      userLimit: dev ? { requests: 100, window: '1 m' } : { requests: 10, window: '5 m' },
      tenantLimit: dev ? { requests: 300, window: '1 m' } : { requests: 50, window: '5 m' },
    })
    const now = Date.now();
    const failures = [userLimit, tenantLimit].filter(r => r && !r.success) as NonNullable<typeof userLimit>[]
    if (failures.length > 0) {
      const soonestReset = Math.min(...failures.map(f => f.reset))
      const retryAfter = Math.max(0, Math.ceil((soonestReset - now) / 1000))
      return rateLimited('AI generation rate limit exceeded', retryAfter, { scope: 'ai_campaign_generate' }, request)
    }

    // Soft budget cap: estimate 500 tokens per request; block if over monthly limit
    if (tenantId) {
      const estTokens = 500
      const budget = await checkTenantBudget(tenantId, estTokens)
      if (!budget.ok) {
        reqLogger.event('warn', { area: 'ai', op: 'budget', status: 'fail', tenantId, errorCode: 'BUDGET_EXCEEDED', msg: budget.message })
        return NextResponse.json({ ok: false, error: { code: 'BUDGET_EXCEEDED', message: 'Your monthly AI budget has been exceeded. Please upgrade your plan.' } }, { status: 402 })
      }
    }

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
        const adjustedType = (() => {
          const ct = String(campaignType || '')
          const nm = String(campaignName || '')
          const offerish = /offer|special/i.test(ct) || /offer|special/i.test(nm)
          return offerish && !/offer/i.test(ct) ? `${ct} offer` : ct
        })()
        userPrompt = generatePostPrompt({
          campaignType: adjustedType,
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
    const phoneRaw = (brandProfile as any).phone ?? (brandProfile as any).phone_e164;
    const waRaw = (brandProfile as any).whatsapp ?? (brandProfile as any).whatsapp_e164;
    const phoneDisplay = phoneRaw ? formatUkPhoneDisplay(phoneRaw) : '';
    const whatsappDisplay = waRaw ? formatUkPhoneDisplay(waRaw) : '';

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
      // Add event date hours (prefer event-day hours; avoid encouraging 'today')
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
          if (line) systemPrompt += `\n- Event day (${dn}): ${line}`;
        }
      } catch {}
    }

    systemPrompt += "\n\nBusiness Details:";
    if (brandProfile.website_url) systemPrompt += `\n- Website: ${brandProfile.website_url}`;
    if (brandProfile.booking_url) systemPrompt += `\n- Booking: ${brandProfile.booking_url}`;
    if (phoneDisplay) systemPrompt += `\n- Phone: ${phoneDisplay}`;
    if (whatsappDisplay) systemPrompt += `\n- WhatsApp: ${whatsappDisplay}`;
    if (openingLines.length > 0) systemPrompt += `\n- Opening hours:\n  ${openingLines.join('\n  ')}`;
    systemPrompt += "\nWhen mentioning opening hours in the copy, refer to the EVENT DAY explicitly (e.g., 'Open Wed HH–HH'). Do NOT use the phrase 'Open today' unless the post is for the event day itself. If hours for the event day are unknown, omit.";

    // Strong link guidance to avoid hallucinated domains
    const preferredLink = brandProfile.booking_url || brandProfile.website_url || ''
    if (preferredLink) {
      systemPrompt += `\nPreferred link to include if a link is used: ${preferredLink}`;
      systemPrompt += `\nNever invent or use any other domain. Use exactly the preferred link once at most.`;
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

    // Always instruct 12-hour time format, relative date wording, and paragraph spacing
    systemPrompt += "\n\nTime formatting: Use 12-hour times with lowercase am/pm and no leading zeros (e.g., 7pm, 8:30pm). Never use 24-hour times.";
    systemPrompt += "\nRelative wording: Prefer 'today', 'tonight', 'tomorrow', 'this Friday', 'next Friday' rather than numeric dates when referencing the event timing.";
    systemPrompt += "\nFormatting: Write 2 short paragraphs separated by a single blank line. No bullet points, no headings, no markdown.";
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

    let generatedContent = completion.choices[0]?.message?.content || "";

    // Normalise links against brand settings post-generation
    try {
      const platformKey = (platform || 'facebook') as string
      const allowedLink = brandProfile.booking_url || brandProfile.website_url || ''
      if (platformKey === 'instagram_business' || platformKey === 'instagram' || platformKey === 'google_my_business') {
        // strip links for IG/GBP text body
        generatedContent = generatedContent.replace(/https?:\/\/\S+|www\.[^\s]+/gi, '').replace(/\n{3,}/g, '\n\n').trim()
      } else if (allowedLink) {
        const hasAllowed = generatedContent.includes(allowedLink)
        const hasAnyUrl = /https?:\/\/\S+|www\.[^\s]+/i.test(generatedContent)
        if (!hasAllowed && hasAnyUrl) {
          generatedContent = generatedContent.replace(/https?:\/\/\S+|www\.[^\s]+/i, allowedLink)
        } else if (!hasAllowed && !hasAnyUrl) {
          generatedContent = `${generatedContent}\n\n${allowedLink}`.trim()
        }
      }
    } catch {}

    // Special Offer post-processing: remove explicit times and ensure deadline mention (expanded detection)
    try {
      const isOffer = /offer|special/i.test(String(campaignType || '')) || /offer|special/i.test(String(campaignName || ''))
      if (isOffer) {
        generatedContent = generatedContent
          .replace(/\b(?:at|from)\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
          .replace(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
          .replace(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
          .replace(/\btonight\b/gi, '')
          .replace(/\btomorrow(\s+night)?\b/gi, '')
          .replace(/\s{2,}/g, ' ').trim()
        // Append explicit end date if not present
        const endPhrase = /offer ends/i.test(generatedContent)
        if (!endPhrase && eventDate) {
          const endStr = formatDate(eventDate, undefined, { day: 'numeric', month: 'long' })
          generatedContent += `\n\nOffer ends ${endStr}.`
        }
        // Normalise naming
        generatedContent = generatedContent.replace(/Manager'?s Special/gi, 'Manager’s Special')
      }
    } catch {}

    // Enforce platform constraints post-generation to avoid preflight failures later
    const platformKey = (platform || 'facebook') as string
    if (platformKey) {
      // First normalise/trim, then enforce hard limits (e.g., Twitter 280 chars)
      generatedContent = enforcePlatformLimits(generatedContent, platformKey)
      const pf = preflight(generatedContent, platformKey)
      // If still failing on length for Twitter, fall back to hard trim
      if (platformKey === 'twitter' && pf.findings.some(f => f.code === 'length_twitter')) {
        generatedContent = enforcePlatformLimits(generatedContent, 'twitter')
      }
    }

    if (tenantId) {
      // Increment usage counters (best-effort)
      try { await incrementUsage(tenantId, { tokens: 500, requests: 1 }) } catch {}
    }
    return ok({ content: generatedContent, platform: platform || 'facebook' }, request)
  } catch (error) {
    safeLog('Generate error:', error);
    return serverError('Failed to generate content. Please try again.', undefined, request)
  }
}
