'use server';

import { revalidatePath } from 'next/cache';

import { getOpenAIClient } from '@/lib/ai/client';
import {
  GbpRateLimitError,
  resolveCanonicalLocationIdViaApi,
} from '@/lib/gbp/business-info';
import { normalizeCanonicalGbpLocationId } from '@/lib/gbp/location-id';
import {
  buildUpsertRow,
  fetchGbpReviews,
  postGbpReply,
  refreshGoogleAccessToken,
} from '@/lib/gbp/reviews';
import { requireAuthContext } from '@/lib/auth/server';
import { getOwnerSettings } from '@/lib/settings/data';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

async function getActiveGbpConnection(accountId: string) {
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from('social_connections')
    .select('access_token, refresh_token, expires_at, metadata')
    .eq('account_id', accountId)
    .eq('provider', 'gbp')
    .maybeSingle<{
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
      metadata: Record<string, unknown> | null;
    }>();
  return data;
}

async function persistCanonicalLocationId(accountId: string, canonicalId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  // Read existing metadata first so we merge rather than replace the entire JSONB object.
  // A plain .update({ metadata: { locationId } }) would wipe any other metadata fields.
  const { data: conn } = await supabase
    .from('social_connections')
    .select('metadata')
    .eq('account_id', accountId)
    .eq('provider', 'gbp')
    .maybeSingle<{ metadata: Record<string, unknown> | null }>();
  const merged = { ...(conn?.metadata ?? {}), locationId: canonicalId };
  const { error } = await supabase
    .from('social_connections')
    .update({ metadata: merged })
    .eq('account_id', accountId)
    .eq('provider', 'gbp');
  if (error) {
    console.error('[persistCanonicalLocationId] Failed to write back canonical ID:', error.message);
  }
}

async function ensureCanonicalLocationId(accountId: string, locationId: string, token: string): Promise<string> {
  const normalized = normalizeCanonicalGbpLocationId(locationId);
  if (normalized) {
    if (normalized !== locationId) {
      await persistCanonicalLocationId(accountId, normalized);
    }
    return normalized;
  }

  const canonical = await resolveCanonicalLocationIdViaApi(locationId, token);
  if (canonical !== locationId) {
    await persistCanonicalLocationId(accountId, canonical);
  }
  return canonical;
}

async function resolveAccessToken(accountId: string): Promise<{ token: string; locationId: string }> {
  const supabase = createServiceSupabaseClient();
  const conn = await getActiveGbpConnection(accountId);

  if (!conn?.access_token || !conn.refresh_token) {
    throw new Error('No active Google Business Profile connection.');
  }

  const locationId = conn.metadata?.locationId as string | undefined;
  if (!locationId) {
    throw new Error('Google Business Profile location ID not configured.');
  }

  // Refresh token if expired or within 5 minutes of expiry
  const isExpired =
    conn.expires_at && new Date(conn.expires_at) < new Date(Date.now() + 5 * 60 * 1000);

  if (isExpired) {
    const { accessToken, expiresAt } = await refreshGoogleAccessToken(conn.refresh_token);
    await supabase
      .from('social_connections')
      .update({ access_token: accessToken, expires_at: expiresAt })
      .eq('account_id', accountId)
      .eq('provider', 'gbp');
    return { token: accessToken, locationId };
  }

  return { token: conn.access_token, locationId };
}

export async function syncGbpReviews(): Promise<{ success?: boolean; synced?: number; error?: string; retryAfter?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  let needsCanonicalRepair = false;

  try {
    const { token, locationId } = await resolveAccessToken(accountId);
    needsCanonicalRepair = !normalizeCanonicalGbpLocationId(locationId);
    const canonicalLocationId = await ensureCanonicalLocationId(accountId, locationId, token);

    const reviews = await fetchGbpReviews(canonicalLocationId, token);

    if (reviews.length === 0) {
      return { success: true, synced: 0 };
    }

    const rows = reviews.map((r) => buildUpsertRow(accountId, r));

    const { error } = await supabase
      .from('gbp_reviews')
      .upsert(rows, {
        onConflict: 'business_profile_id,google_review_id',
        ignoreDuplicates: false,
      });

    if (error) throw error;

    revalidatePath('/reviews');
    return { success: true, synced: rows.length };
  } catch (err) {
    console.error('[syncGbpReviews]', err);
    if (err instanceof GbpRateLimitError) {
      const retryMs = (err.retryAfterSeconds ?? 120) * 1000;
      return {
        error: needsCanonicalRepair
          ? `Google Business Profile refresh is temporarily blocked because this connection still needs a canonical numeric location ID. ${err.googleDetail}`
          : `Google Business Profile API is rate limited. ${err.googleDetail}`,
        retryAfter: new Date(Date.now() + retryMs).toISOString(),
      };
    }
    const message = err instanceof Error ? err.message : 'Sync failed.';
    return { error: message };
  }
}

function buildSystemPrompt(venueName: string | undefined, toneFormal: number, tonePlayful: number, bannedPhrases: string[], keyPhrases: string[]): string {
  const name = venueName ?? 'this pub';

  const formalityDesc =
    toneFormal > 0.7 ? 'formal' : toneFormal < 0.3 ? 'casual and relaxed' : 'balanced (neither stiff nor overly casual)';
  const playfulnessDesc =
    tonePlayful > 0.7 ? 'playful and witty' : tonePlayful < 0.3 ? 'straightforward and sincere' : 'lightly playful';

  const lines: string[] = [
    `You are responding to Google reviews on behalf of ${name}, a pub.`,
    `Tone: ${formalityDesc} in register, ${playfulnessDesc} in personality.`,
    `Always be positive, warm, encouraging, supportive, and inclusive. Responses should feel genuine and personal — not templated.`,
    `Keep replies concise (2–4 sentences).`,
    `If the review is negative, acknowledge the experience with empathy, apologise sincerely, and invite the reviewer to get in touch directly.`,
    `If the review is positive, thank them warmly and express that you look forward to seeing them again.`,
    `Write as the pub team using "we", "us", "our" — never "I".`,
    `Always use British English.`,
  ];

  if (bannedPhrases.length > 0) {
    lines.push(`Avoid these phrases: ${bannedPhrases.join(', ')}.`);
  }

  if (keyPhrases.length > 0) {
    lines.push(`Weave in these phrases naturally if appropriate: ${keyPhrases.join(', ')}.`);
  }

  return lines.join('\n');
}

export async function generateAiDraft(reviewId: string): Promise<{ success?: boolean; draft?: string; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: review, error: fetchError } = await supabase
    .from('gbp_reviews')
    .select('id, star_rating, comment, business_profile_id')
    .eq('id', reviewId)
    .eq('business_profile_id', accountId)
    .single<{ id: string; star_rating: number; comment: string | null; business_profile_id: string }>();

  if (fetchError || !review) {
    return { error: 'Review not found.' };
  }

  // Build dynamic system prompt from brand profile; fall back to a generic prompt if settings unavailable.
  let systemPrompt: string;
  try {
    const { brand, venueName } = await getOwnerSettings();
    systemPrompt = buildSystemPrompt(venueName, brand.toneFormal, brand.tonePlayful, brand.bannedPhrases, brand.keyPhrases);
  } catch (settingsErr) {
    console.warn('[generateAiDraft] Could not load owner settings, using fallback prompt:', settingsErr);
    // Fallback: generic prompt without brand-specific tone or phrase lists.
    systemPrompt = buildSystemPrompt(undefined, 0.5, 0.5, [], []);
  }

  const userMessage = review.comment
    ? `Star rating: ${review.star_rating}/5\nReview: "${review.comment}"`
    : `Star rating: ${review.star_rating}/5\n(No written comment — rating only)`;

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 200,
    });

    const draft = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!draft) return { error: 'AI returned an empty response.' };

    await supabase
      .from('gbp_reviews')
      .update({ ai_draft: draft, status: 'draft_ready' })
      .eq('id', reviewId)
      .eq('business_profile_id', accountId);

    revalidatePath('/reviews');
    return { success: true, draft };
  } catch (err) {
    console.error('[generateAiDraft]', err);
    return { error: err instanceof Error ? err.message : 'AI generation failed.' };
  }
}

export async function postReply(reviewId: string, comment: string): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  let needsCanonicalRepair = false;

  const { data: review } = await supabase
    .from('gbp_reviews')
    .select('google_review_id, business_profile_id')
    .eq('id', reviewId)
    .eq('business_profile_id', accountId)
    .single<{ google_review_id: string; business_profile_id: string }>();

  if (!review) return { error: 'Review not found.' };

  try {
    const { token, locationId } = await resolveAccessToken(accountId);
    needsCanonicalRepair = !normalizeCanonicalGbpLocationId(locationId);
    const canonicalLocationId = await ensureCanonicalLocationId(accountId, locationId, token);

    const reviewName = `${canonicalLocationId}/reviews/${review.google_review_id}`;
    await postGbpReply(reviewName, comment, token);

    await supabase
      .from('gbp_reviews')
      .update({
        reply_comment: comment,
        reply_update_time: new Date().toISOString(),
        status: 'replied',
      })
      .eq('id', reviewId)
      .eq('business_profile_id', accountId);

    revalidatePath('/reviews');
    return { success: true };
  } catch (err) {
    console.error('[postReply]', err);
    if (err instanceof GbpRateLimitError) {
      return {
        error: needsCanonicalRepair
          ? `Google Business Profile reply is temporarily blocked because this connection still needs a canonical numeric location ID. ${err.googleDetail}`
          : `Google Business Profile API is rate limited. ${err.googleDetail}`,
      };
    }
    const message = err instanceof Error ? err.message : 'Failed to post reply.';
    return { error: message };
  }
}

export async function saveAiDraft(reviewId: string, draft: string): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { error } = await supabase
    .from('gbp_reviews')
    .update({ ai_draft: draft })
    .eq('id', reviewId)
    .eq('business_profile_id', accountId);

  if (error) return { error: error.message };
  return { success: true };
}
