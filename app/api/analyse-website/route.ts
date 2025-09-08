import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { unauthorized, badRequest, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const parsed = z.object({ url: z.string().min(1) }).safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'URL is required', parsed.error.format(), request)
    }
    const { url } = parsed.data

    // Normalize and validate URL
    let normalizedUrl = url.trim();
    
    // Remove trailing slashes
    normalizedUrl = normalizedUrl.replace(/\/+$/, '');
    
    // Add protocol if missing
    if (!normalizedUrl.match(/^https?:\/\//i)) {
      // Check if it starts with www or looks like a domain
      if (normalizedUrl.match(/^(www\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+/)) {
        normalizedUrl = 'https://' + normalizedUrl;
      } else {
        return badRequest('invalid_url', 'Invalid URL format. Please enter a valid website address.', undefined, request)
      }
    }

    // Validate URL format
    let validUrl;
    try {
      validUrl = new URL(normalizedUrl);
      // Ensure it's http or https
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch (e) {
      return badRequest('invalid_url', 'Invalid URL format. Please enter a valid website address.', undefined, request)
    }

    // Use the WebFetch tool functionality to analyse the website
    try {
      // Fetch and analyse the website content with timeout and redirect handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(validUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CheersAI/1.0; +https://cheersai.orangejelly.co.uk)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch website: ${response.status}`);
      }

      // Get HTML content
      const html = await response.text();
      
      // Extract text content from HTML (basic extraction)
      const textContent = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
        .replace(/<[^>]+>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .substring(0, 5000); // Limit content length

      // Use OpenAI to analyse the content for multiple brand aspects
      const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are analysing a UK pub or hospitality business website to extract their brand information. 
                Analyze the content and provide THREE distinct pieces of information in JSON format:
                
                1. targetAudience: Their typical customers (2-3 sentences, demographics, interests, behaviours)
                2. brandVoice: A written description of their brand voice and tone (2-3 sentences describing how they communicate, their personality, and communication style)
                3. brandIdentity: Their brand story, values, and what makes them unique (3-4 sentences about their history, values, community role, and unique selling points)
                
                IMPORTANT: Use British English spelling in all responses (e.g., customise NOT customize, analyse NOT analyze, colour NOT color, centre NOT center, behaviour NOT behavior).
                
                Return ONLY valid JSON in this exact format:
                {
                  "targetAudience": "description here",
                  "brandVoice": "brand voice description here",
                  "brandIdentity": "identity description here"
                }`
            },
            {
              role: "user",
              content: `Website URL: ${url}\n\nWebsite content:\n${textContent}\n\nAnalyze and extract brand information.`
            }
          ],
          temperature: 0.7,
          max_tokens: 400,
          response_format: { type: "json_object" }
        }),
      });

      if (!openAIResponse.ok) {
        throw new Error("Failed to analyse content with AI");
      }

      const aiData = await openAIResponse.json();
      let analysisResult;
      
      try {
        analysisResult = JSON.parse(aiData.choices[0]?.message?.content || "{}");
      } catch (parseError) {
        // Fallback if JSON parsing fails
        analysisResult = {
          targetAudience: aiData.choices[0]?.message?.content?.trim() || "",
          brandVoice: "",
          brandIdentity: ""
        };
      }

      // Ensure brand voice is a string
      if (!analysisResult.brandVoice || typeof analysisResult.brandVoice !== 'string') {
        analysisResult.brandVoice = "";
      }

      if (!analysisResult.targetAudience) {
        throw new Error("Could not generate audience analysis");
      }

      return ok({ 
        targetAudience: analysisResult.targetAudience,
        brandVoice: analysisResult.brandVoice || "",
        brandIdentity: analysisResult.brandIdentity || "",
        success: true 
      }, request);

    } catch (fetchError: any) {
      console.error("Website fetch error:", fetchError);
      
      // Determine the type of error and provide helpful feedback
      let errorMessage = "Could not access the website. ";
      let fallbackAudience = "";
      
      if (fetchError.name === 'AbortError') {
        errorMessage += "The website took too long to respond.";
      } else if (fetchError.message?.includes('fetch')) {
        errorMessage += "Please check the URL and try again.";
      } else {
        errorMessage += "The website might be temporarily unavailable.";
      }
      
      // Provide a helpful fallback based on the domain name
      const domainParts = validUrl.hostname.replace('www.', '').split('.');
      const businessName = domainParts[0].replace(/-/g, ' ');
      
      fallbackAudience = `Based on your venue "${businessName}", typical customers might include local families, regular patrons, and visitors looking for authentic pub experiences. They likely value good food, drinks, friendly service, and a welcoming atmosphere. Please customise this to match your actual customer base.`;
      
      const fallbackIdentity = `We're a welcoming establishment focused on providing quality food, drinks, and a comfortable atmosphere for our community. Please customise this to reflect your unique story and values.`;
      
      return ok({ 
        targetAudience: fallbackAudience,
        brandVoice: "We communicate in a friendly, welcoming tone that reflects our traditional values while keeping things casual and approachable. Our voice is warm, genuine, and focused on creating a comfortable atmosphere for all our guests.",
        brandIdentity: fallbackIdentity,
        success: true,
        fallback: true,
        warning: errorMessage
      }, request);
    }

  } catch (error) {
    console.error("Website analysis error:", error);
    return serverError('Failed to analyse website', undefined, request)
  }
}
