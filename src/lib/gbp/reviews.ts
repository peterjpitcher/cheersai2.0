import type { GmbApiReview, GmbReviewsResponse } from '@/types/reviews';

// The v4 mybusiness API was deprecated; reviews now live on the dedicated Reviews API
const GMB_BASE = 'https://mybusinessreviews.googleapis.com/v1';
const GBP_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

// Place IDs (e.g. ChIJ...) are accepted by the Business Information API but rejected
// by the Reviews API, which requires the canonical numeric resource name (locations/12345).
// This resolves a Place ID to its canonical form via the Business Information API.
export async function resolveCanonicalLocationId(locationId: string, accessToken: string): Promise<string> {
  // Already a numeric resource name — no resolution needed
  if (/^locations\/\d+$/.test(locationId)) return locationId;

  try {
    const response = await fetch(
      `${GBP_INFO_BASE}/${locationId}?readMask=name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return locationId;
    const json = await response.json() as { name?: string };
    return json.name ?? locationId;
  } catch {
    return locationId;
  }
}

const STAR_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

export function starRatingToNumber(rating: string): number {
  return STAR_MAP[rating] ?? 0;
}

export function buildUpsertRow(businessProfileId: string, review: GmbApiReview) {
  const hasReply = !!review.reviewReply;
  return {
    business_profile_id: businessProfileId,
    google_review_id: review.reviewId,
    reviewer_name: review.reviewer.displayName,
    star_rating: starRatingToNumber(review.starRating),
    comment: review.comment ?? null,
    create_time: review.createTime,
    update_time: review.updateTime,
    reply_comment: review.reviewReply?.comment ?? null,
    reply_update_time: review.reviewReply?.updateTime ?? null,
    status: hasReply ? 'replied' : 'pending',
    synced_at: new Date().toISOString(),
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(`Google token refresh failed: ${json.error ?? 'unknown'}`);
  }
  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  return { accessToken: json.access_token, expiresAt };
}

export async function fetchGbpReviews(
  locationId: string,
  accessToken: string,
): Promise<GmbApiReview[]> {
  const canonicalId = await resolveCanonicalLocationId(locationId, accessToken);
  const reviews: GmbApiReview[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GMB_BASE}/${canonicalId}/reviews`);
    url.searchParams.set('pageSize', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GBP reviews fetch failed (${response.status}): ${text}`);
    }

    const json = await response.json() as GmbReviewsResponse;
    if (json.reviews) reviews.push(...json.reviews);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return reviews;
}

export async function postGbpReply(
  reviewName: string,
  comment: string,
  accessToken: string,
): Promise<void> {
  // reviewName is the full resource name, e.g. locations/ChIJ.../reviews/{reviewId}
  const response = await fetch(
    `${GMB_BASE}/${reviewName}/reply`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GBP reply failed (${response.status}): ${text}`);
  }
}
