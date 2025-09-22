import { NextRequest } from 'next/server'
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { unauthorized, badRequest, ok, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'
import { fetchWithTimeout, createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

type ResolvedAddress = { address: string; family: 4 | 6 }

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '::',
])

const ALLOWED_PORTS = new Set(['', '80', '443'])
const MAX_REDIRECTS = 3

function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.').map(part => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some(Number.isNaN)) {
    return true
  }
  const [a, b] = octets
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 100 && b >= 64 && b <= 127) return true // Carrier-grade NAT
  if (a === 169 && b === 254) return true // Link local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function isPrivateIPv6(address: string): boolean {
  const normalised = address.toLowerCase()
  if (normalised === '::1' || normalised === '::') return true
  if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true // Unique local
  if (normalised.startsWith('fe80')) return true // Link local
  if (normalised.startsWith('::ffff:')) {
    const mapped = normalised.slice('::ffff:'.length)
    return isPrivateIPv4(mapped)
  }
  return false
}

function isRestrictedAddress(resolved: ResolvedAddress): boolean {
  if (resolved.family === 4) {
    return isPrivateIPv4(resolved.address)
  }
  return isPrivateIPv6(resolved.address)
}

async function resolveAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const ipVersion = isIP(hostname)
  if (ipVersion === 4 || ipVersion === 6) {
    return [{ address: hostname, family: ipVersion }]
  }
  try {
    const records = await lookup(hostname, { all: true, verbatim: false })
    return records.map(record => ({ address: record.address, family: (record.family === 6 ? 6 : 4) as 4 | 6 }))
  } catch {
    return []
  }
}

async function assertSafeUrl(url: URL) {
  const hostname = url.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('Local or loopback addresses are not allowed')
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError('Only standard web ports are allowed')
  }
  const resolved = await resolveAddresses(hostname)
  if (resolved.length === 0) {
    throw new UnsafeUrlError('Could not resolve the destination host')
  }
  if (resolved.some(isRestrictedAddress)) {
    throw new UnsafeUrlError('Private or internal network addresses are not allowed')
  }
}

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
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
    let validUrl: URL;
    try {
      validUrl = new URL(normalizedUrl);
      // Ensure it's http or https
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      return badRequest('invalid_url', 'Invalid URL format. Please enter a valid website address.', undefined, request)
    }

    if (!process.env.OPENAI_API_KEY) {
      reqLogger.error('analyse-website: OPENAI_API_KEY missing', {
        area: 'insights',
        op: 'analyse-website.openai',
        status: 'fail',
      })
      return serverError('AI analysis service is not configured', undefined, request)
    }

    // Use the WebFetch tool functionality to analyse the website
    try {
      let currentUrl = new URL(validUrl.toString())
      let redirects = 0
      let websiteResponse: Response | null = null

      while (redirects <= MAX_REDIRECTS) {
        await assertSafeUrl(currentUrl)
        const response = await withRetry(
          () => fetchWithTimeout(currentUrl.toString(), {
            method: 'GET',
            headers: {
              'User-Agent': `Mozilla/5.0 (compatible; CheersAI/1.0; +${process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.cheersai.uk'})`,
              'Accept': 'text/html,application/xhtml+xml',
            },
            redirect: 'manual',
            timeout: 10000,
          }),
          { maxAttempts: 2, initialDelay: 500, maxDelay: 1500 }
        )

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) {
            if (response.body) {
              void response.body.cancel()
            }
            throw new Error('Redirect response missing location header')
          }
          if (redirects >= MAX_REDIRECTS) {
            if (response.body) {
              void response.body.cancel()
            }
            throw new Error('Too many redirects while fetching website')
          }
          const nextUrl = new URL(location, currentUrl)
          await assertSafeUrl(nextUrl)
          if (response.body) {
            void response.body.cancel()
          }
          currentUrl = nextUrl
          redirects += 1
          continue
        }

        if (!response.ok) {
          if (response.body) {
            void response.body.cancel()
          }
          throw new Error(`Failed to fetch website: ${response.status}`)
        }

        websiteResponse = response
        break
      }

      if (!websiteResponse) {
        throw new Error('Failed to fetch website')
      }

      // Get HTML content
      const html = await websiteResponse.text();

      // Extract text content from HTML (basic extraction)
      const textContent = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
        .replace(/<[^>]+>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .substring(0, 5000); // Limit content length

      // Use OpenAI to analyse the content for multiple brand aspects
      const openaiFetch = createServiceFetch('openai')
      const openAIResponse = await withRetry(
        () => openaiFetch("https://api.openai.com/v1/chat/completions", {
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
        }),
        { maxAttempts: 3, initialDelay: 1000, maxDelay: 4000 }
      )

      if (!openAIResponse.ok) {
        throw new Error("Failed to analyse content with AI");
      }

      const aiData = await openAIResponse.json();
      let analysisResult;
      
      try {
        analysisResult = JSON.parse(aiData.choices[0]?.message?.content || "{}");
      } catch {
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

    } catch (fetchError: unknown) {
      if (fetchError instanceof UnsafeUrlError) {
        return badRequest('invalid_url', fetchError.message, undefined, request)
      }
      reqLogger.warn('Website fetch error', {
        area: 'insights',
        op: 'analyse-website.fetch',
        status: 'fail',
        error: fetchError instanceof Error ? fetchError : new Error(String(fetchError)),
      });
      
      // Determine the type of error and provide helpful feedback
      let errorMessage = "Could not access the website. ";
      let fallbackAudience = "";
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        errorMessage += "The website took too long to respond.";
      } else if (fetchError instanceof Error && fetchError.message?.includes('fetch')) {
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
    reqLogger.error('Website analysis handler error', {
      area: 'insights',
      op: 'analyse-website',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return serverError('Failed to analyse website', undefined, request)
  }
}
