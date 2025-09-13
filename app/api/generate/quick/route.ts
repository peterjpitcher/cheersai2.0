import { NextRequest, NextResponse } from "next/server";
import { formatDate } from "@/lib/datetime";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";
import { preflight } from '@/lib/preflight'
import { enforcePlatformLimits } from '@/lib/utils/text'
import { z } from 'zod'
import { quickGenerateSchema } from '@/lib/validation/schemas'
import { unauthorized, badRequest, ok, serverError, rateLimited } from '@/lib/http'
import { enforceUserAndTenantLimits } from '@/lib/rate-limit'
import { checkTenantBudget, incrementUsage } from '@/lib/usage'
import { scrubSensitive, safeLog } from '@/lib/scrub'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return badRequest('openai_not_configured', 'AI text generation is not configured on this server. Please set OPENAI_API_KEY.', request)
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const raw = await request.json();
    const parsed = z.object(quickGenerateSchema.shape).extend({ platforms: z.array(z.string()).optional() }).safeParse(raw)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid quick generate payload', parsed.error.format(), request)
    }
    const { prompt, tone, platforms } = parsed.data as any

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

    // Rate limit per user and per tenant (AI is costly)
    const { user: userLimit, tenant: tenantLimit } = await enforceUserAndTenantLimits({
      userId: user.id,
      tenantId: userData?.tenant_id ?? undefined,
      userLimit: { requests: 10, window: '5 m' },
      tenantLimit: { requests: 50, window: '5 m' },
    })
    const now = Date.now()
    const failures = [userLimit, tenantLimit].filter(r => r && !r.success) as NonNullable<typeof userLimit>[]
    if (failures.length > 0) {
      const soonestReset = Math.min(...failures.map(f => f.reset))
      const retryAfter = Math.max(0, Math.ceil((soonestReset - now) / 1000))
      return rateLimited('AI generation rate limit exceeded', retryAfter, { scope: 'ai_quick_generate' }, request)
    }

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

    const tenantName = Array.isArray((userData as any)?.tenant) ? (userData as any).tenant[0]?.name : (userData as any)?.tenant?.name;
    const businessName = brandProfile?.business_name || tenantName || "The Pub";
    const businessType = brandProfile?.business_type || "pub";

    // Generate content with brand identity
    let systemPrompt = `You are a social media expert for ${businessType}s in the UK. 
Write engaging, friendly posts that drive foot traffic and create community engagement.
Keep posts concise (2 short paragraphs), use relevant emojis, and include a clear call-to-action.
Formatting: If more than one paragraph, leave a single blank line between paragraphs. No markdown or bullet points.

IMPORTANT: Always use British English spelling and UK terminology:
- Use: customise, analyse, organise, realise, optimise, specialise, recognise, maximise, minimise, summarise
- NOT: customize, analyze, organize, realize, optimize, specialize, recognize, maximize, minimize, summarize
- Use: colour, favour, behaviour, honour, centre, theatre, cancelled, modelled
- NOT: color, favor, behavior, honor, center, theater, canceled, modeled
- Use British idioms and expressions appropriate for UK hospitality businesses.`;

    // Add business details (links, phones, opening hours)
    const { formatUkPhoneDisplay } = await import('@/lib/utils/format');
    const phoneDisplay = brandProfile?.phone_e164 ? formatUkPhoneDisplay(brandProfile.phone_e164) : '';
    const whatsappDisplay = brandProfile?.whatsapp_e164 ? formatUkPhoneDisplay(brandProfile.whatsapp_e164) : '';
    const openingLines: string[] = [];
    if (brandProfile?.opening_hours && typeof brandProfile.opening_hours === 'object') {
      const days = ['mon','tue','wed','thu','fri','sat','sun'] as const;
      const dayNames: Record<string,string> = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
      for (const d of days) {
        const info: any = (brandProfile.opening_hours as any)[d];
        if (!info) continue;
        if (info.closed) openingLines.push(`${dayNames[d]}: Closed`);
        else if (info.open && info.close) openingLines.push(`${dayNames[d]}: ${info.open}–${info.close}`);
      }
      // Today's hours with exceptions
      try {
        const today = new Date();
        const yyyy = today.toISOString().split('T')[0];
        const dn = formatDate(today, undefined, { weekday: 'short' });
        const ex = Array.isArray((brandProfile.opening_hours as any).exceptions)
          ? (brandProfile.opening_hours as any).exceptions.find((e: any) => e.date === yyyy)
          : null;
        const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][today.getDay()];
        let line = '';
        if (ex) line = ex.closed ? 'Closed' : (ex.open && ex.close ? `${ex.open}–${ex.close}` : '');
        else if ((brandProfile.opening_hours as any)[dayKey]) {
          const base = (brandProfile.opening_hours as any)[dayKey];
          line = base.closed ? 'Closed' : (base.open && base.close ? `${base.open}–${base.close}` : '');
        }
        if (line) systemPrompt += `\n- Today (${dn}): ${line}`;
      } catch {}
    }

    if (brandProfile) {
      systemPrompt += "\n\nBusiness Details:";
      if (brandProfile.website_url) systemPrompt += `\n- Website: ${brandProfile.website_url}`;
      if (brandProfile.booking_url) systemPrompt += `\n- Booking: ${brandProfile.booking_url}`;
      if (phoneDisplay) systemPrompt += `\n- Phone: ${phoneDisplay}`;
      if (whatsappDisplay) systemPrompt += `\n- WhatsApp: ${whatsappDisplay}`;
      if (openingLines.length > 0) systemPrompt += `\n- Opening hours:\n  ${openingLines.join('\n  ')}`;
      systemPrompt += "\nInclude opening hours in a natural way when promoting visits: if the post is for today or not date-specific, include a short line like 'Open today HH–HH' using today's hours; if clearly for a future day, you may include 'Open {Weekday} HH–HH' for that day. If hours not known for that day, omit.";
    }

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

      const platformName = platform === 'instagram_business' ? 'Instagram' : (platform === 'google_my_business' ? 'Google Business Profile' : platform);

      return (
`Write a quick ${platformName} update for ${businessName}. Make it ${tone || 'friendly and engaging'}.
Focus on creating urgency or excitement about visiting today.
If a time is mentioned, use 12-hour style with lowercase am/pm (e.g., 7pm, 8:30pm) — never 24-hour.
Use relative wording (today, tonight, this Friday) rather than numeric dates.
Write the post as 1–2 short paragraphs separated by a single blank line. No bullet points, no markdown.
Link handling: ${linkInstruction}

Inspiration/context: ${prompt || 'general daily update'}`);
    };

    const targetPlatforms: string[] = Array.isArray(platforms) && platforms.length > 0 ? platforms : ['facebook'];
    // Budget caps (estimate 300 tokens per quick post per platform)
    if (userData?.tenant_id) {
      const estTokens = 300 * targetPlatforms.length
      const budget = await checkTenantBudget(userData.tenant_id, estTokens)
      if (!budget.ok) {
        return NextResponse.json({ ok: false, error: { code: 'BUDGET_EXCEEDED', message: 'Your monthly AI budget has been exceeded.' } }, { status: 402 })
      }
    }
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
      let text = completion.choices[0]?.message?.content || "";
      // Enforce platform constraints to avoid later preflight failures
      text = enforcePlatformLimits(text, p)
      const pf = preflight(text, p)
      if (p === 'twitter' && pf.findings.some(f => f.code === 'length_twitter')) {
        text = enforcePlatformLimits(text, 'twitter')
      }
      contents[p] = text;
    }

    if (userData?.tenant_id) {
      try { await incrementUsage(userData.tenant_id, { tokens: 300 * targetPlatforms.length, requests: 1 }) } catch {}
    }
    return ok({ contents }, request)
  } catch (error) {
    safeLog("Quick post generation error:", error);
    return serverError('Failed to generate content', undefined, request)
  }
}
