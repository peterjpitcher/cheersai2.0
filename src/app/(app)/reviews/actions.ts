'use server';

import { revalidatePath } from 'next/cache';

import { getOpenAIClient } from '@/lib/ai/client';
import {
  buildUpsertRow,
  fetchGbpReviews,
  postGbpReply,
  refreshGoogleAccessToken,
  resolveCanonicalLocationId,
} from '@/lib/gbp/reviews';
import { requireAuthContext } from '@/lib/auth/server';
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
  const { error } = await supabase
    .from('social_connections')
    .update({ metadata: { locationId: canonicalId } })
    .eq('account_id', accountId)
    .eq('provider', 'gbp');
  if (error) {
    console.error('[persistCanonicalLocationId] Failed to write back canonical ID:', error.message);
  }
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

export async function syncGbpReviews(): Promise<{ success?: boolean; synced?: number; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  try {
    const { token, locationId } = await resolveAccessToken(accountId);

    // Resolve once here so we can write back to DB — fetchGbpReviews will hit early return
    const canonicalLocationId = await resolveCanonicalLocationId(locationId, token);
    if (canonicalLocationId !== locationId) {
      persistCanonicalLocationId(accountId, canonicalLocationId).catch((e) =>
        console.error('[syncGbpReviews] write-back failed:', e),
      );
    }

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
    const message = err instanceof Error ? err.message : 'Sync failed.';
    const userMessage = message.startsWith('RATE_LIMITED:')
      ? 'Google Business Profile API is rate limited. Please try again in a few minutes.'
      : message;
    return { error: userMessage };
  }
}

const SYSTEM_PROMPT = `You are responding to Google reviews on behalf of The Anchor, a pub. Always be positive, warm, encouraging, supportive, and inclusive. Responses should feel genuine and personal — not templated. Keep replies concise (2–4 sentences). If the review is negative, acknowledge the experience with empathy, apologise sincerely, and invite the reviewer to get in touch directly. If the review is positive, thank them warmly and express that you look forward to seeing them again.`;

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

  const userMessage = review.comment
    ? `Star rating: ${review.star_rating}/5\nReview: "${review.comment}"`
    : `Star rating: ${review.star_rating}/5\n(No written comment — rating only)`;

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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

  const { data: review } = await supabase
    .from('gbp_reviews')
    .select('google_review_id, business_profile_id')
    .eq('id', reviewId)
    .eq('business_profile_id', accountId)
    .single<{ google_review_id: string; business_profile_id: string }>();

  if (!review) return { error: 'Review not found.' };

  try {
    const { token, locationId } = await resolveAccessToken(accountId);
    const canonicalLocationId = await resolveCanonicalLocationId(locationId, token);

    // Write back canonical ID if it differs
    if (canonicalLocationId !== locationId) {
      persistCanonicalLocationId(accountId, canonicalLocationId).catch((e) =>
        console.error('[postReply] write-back failed:', e),
      );
    }

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
    const message = err instanceof Error ? err.message : 'Failed to post reply.';
    const userMessage = message.startsWith('RATE_LIMITED:')
      ? 'Google Business Profile API is rate limited. Please try again in a few minutes.'
      : message;
    return { error: userMessage };
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
