import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

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
        return NextResponse.json({ error: "Invalid URL format. Please enter a valid website address." }, { status: 400 });
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
      return NextResponse.json({ error: "Invalid URL format. Please enter a valid website address." }, { status: 400 });
    }

    // Use the WebFetch tool functionality to analyze the website
    try {
      // Fetch and analyze the website content with timeout and redirect handling
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

      // Use OpenAI to analyze the content
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
              content: `You are analyzing a pub or hospitality business website to determine their target audience. 
                Based on the website content, identify and describe their typical customers.
                Focus on demographics, interests, and behaviors.
                Be specific but concise (2-3 sentences max).
                Format: Start with the main customer groups, then their characteristics.
                Example: "Local families and young professionals who enjoy craft beer and live music. They value community atmosphere, quality food, and regular events."`
            },
            {
              role: "user",
              content: `Website URL: ${url}\n\nWebsite content:\n${textContent}\n\nBased on this, who is their target audience?`
            }
          ],
          temperature: 0.7,
          max_tokens: 150,
        }),
      });

      if (!openAIResponse.ok) {
        throw new Error("Failed to analyze content with AI");
      }

      const aiData = await openAIResponse.json();
      const targetAudience = aiData.choices[0]?.message?.content?.trim();

      if (!targetAudience) {
        throw new Error("Could not generate audience analysis");
      }

      return NextResponse.json({ 
        targetAudience,
        success: true 
      });

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
      
      fallbackAudience = `Based on your venue "${businessName}", typical customers might include local families, regular patrons, and visitors looking for authentic pub experiences. They likely value good food, drinks, friendly service, and a welcoming atmosphere. Please customize this to match your actual customer base.`;
      
      return NextResponse.json({ 
        targetAudience: fallbackAudience,
        success: true,
        fallback: true,
        warning: errorMessage
      });
    }

  } catch (error) {
    console.error("Website analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze website" },
      { status: 500 }
    );
  }
}