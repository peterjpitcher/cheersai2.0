import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";
import { z } from 'zod'
import { unauthorized, badRequest, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { withRetry } from '@/lib/reliability/retry'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return badRequest('tenant_missing', 'No tenant found', undefined, request)
    }

    const parsed = z.object({ samples: z.array(z.object({ content: z.string().min(1) })).min(5) }).safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'At least 5 samples required for training', parsed.error.format(), request)
    }
    const { samples } = parsed.data

    // Analyze samples with AI
    const analysisPrompt = `Analyze these writing samples and extract:
1. Tone attributes (professional, casual, humorous, etc.)
2. Common vocabulary and phrases
3. Sentence structure patterns
4. Average sentence length
5. Emoji usage (yes/no and frequency)
6. Hashtag style (none, minimal, moderate, heavy)
7. Unique writing characteristics

Samples:
${samples.map((s: any) => s.content).join('\n---\n')}

Return a JSON object with these properties:
{
  "tone_attributes": ["attribute1", "attribute2"],
  "vocabulary": ["unique_word1", "phrase1"],
  "sentence_patterns": {
    "opening_patterns": ["pattern1"],
    "closing_patterns": ["pattern1"],
    "transition_words": ["word1"]
  },
  "avg_sentence_length": number,
  "emoji_usage": boolean,
  "emoji_frequency": "none" | "low" | "medium" | "high",
  "hashtag_style": "none" | "minimal" | "moderate" | "heavy",
  "characteristics": ["characteristic1"]
}`;

    const completion = await withRetry(
      () =>
        openai.chat.completions.create({
          model: "gpt-4-turbo-preview",
          messages: [
            {
              role: "system",
              content: "You are a linguistic analyst specialising in brand voice analysis. Return only valid JSON."
            },
            {
              role: "user",
              content: analysisPrompt
            }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        }),
      { maxAttempts: 3, initialDelay: 750, maxDelay: 3000 }
    )

    const analysis = JSON.parse(completion.choices[0].message.content || "{}");

    // Store voice profile
    const { data: profile, error } = await supabase
      .from("brand_voice_profiles")
      .upsert({
        tenant_id: userData.tenant_id,
        tone_attributes: analysis.tone_attributes || [],
        vocabulary: analysis.vocabulary || [],
        sentence_patterns: analysis.sentence_patterns || {},
        avg_sentence_length: analysis.avg_sentence_length || 15,
        emoji_usage: analysis.emoji_usage || false,
        emoji_frequency: analysis.emoji_frequency || "none",
        hashtag_style: analysis.hashtag_style || "minimal",
        characteristics: analysis.characteristics || [],
        sample_count: samples.length,
        trained_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id'
      })
      .select()
      .single();

    if (error) {
      reqLogger.error('Error saving voice profile', {
        area: 'ai',
        op: 'train-voice',
        status: 'fail',
        error,
        meta: { tenantId: userData.tenant_id },
      })
      return serverError('Failed to save voice profile', error, request)
    }

    reqLogger.info('Voice profile trained', {
      area: 'ai',
      op: 'train-voice',
      status: 'ok',
      meta: { tenantId: userData.tenant_id, sampleCount: samples.length },
    })

    return ok(profile, request);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Voice training error', {
      area: 'ai',
      op: 'train-voice',
      status: 'fail',
      error: err,
    })
    logger.error('Voice training error', {
      area: 'ai',
      op: 'train-voice',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to train voice model', undefined, request)
  }
}
