import type { GmbApiReview, GmbReviewsResponse } from '@/types/reviews';

// The v4 mybusiness API was deprecated; reviews now live on the dedicated Reviews API
const GMB_BASE = 'https://mybusinessreviews.googleapis.com/v1';
const GBP_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

// Place IDs (e.g. ChIJ...) are accepted by the Business Information API but rejected
// by the Reviews API, which requires the canonical numeric resource name (locations/12345).
// This resolves a Place ID to its canonical form via the Business Information API.
// Account Management API is the correct endpoint for listing GBP accounts.
// The Business Information API is tried first for compatibility with existing tokens.
const GBP_ACCOUNT_BASES = [
  GBP_INFO_BASE,
  'https://mybusinessaccountmanagement.googleapis.com/v1',
];

// Extract the canonical `locations/{numericId}` segment from any resource name.
// Handles both "locations/12345" and "accounts/678/locations/12345" formats.
function extractLocationSegment(name: string): string | null {
  const match = name.match(/locations\/(\d+)/);
  return match ? `locations/${match[1]}` : null;
}

export async function resolveCanonicalLocationId(locationId: string, accessToken: string): Promise<string> {
  // Already a canonical numeric resource name — no resolution needed
  if (/^locations\/\d+$/.test(locationId)) return locationId;

  console.warn('[resolveCanonicalLocationId] Non-canonical locationId, resolving:', locationId);

  const headers = { Authorization: `Bearer ${accessToken}` };

  // Step 1: Try direct lookup via Business Information API
  try {
    const response = await fetch(
      `${GBP_INFO_BASE}/${locationId}?readMask=name`,
      { headers },
    );
    if (response.ok) {
      const json = await response.json() as { name?: string };
      const canonical = json.name ? extractLocationSegment(json.name) : null;
      if (canonical) {
        console.warn('[resolveCanonicalLocationId] Resolved via direct lookup:', canonical);
        return canonical;
      }
      console.warn('[resolveCanonicalLocationId] Direct lookup returned unexpected name:', json.name);
    } else {
      const text = await response.text();
      console.warn('[resolveCanonicalLocationId] Direct lookup failed:', response.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn('[resolveCanonicalLocationId] Direct lookup error:', e);
  }

  // Step 2: Enumerate accounts → locations; try each known accounts API base.
  // The raw Place ID is the part after any "locations/" prefix.
  const rawPlaceId = locationId.replace(/^locations\//, '');

  for (const accountBase of GBP_ACCOUNT_BASES) {
    try {
      const accountsResponse = await fetch(`${accountBase}/accounts`, { headers });
      if (!accountsResponse.ok) {
        const text = await accountsResponse.text();
        console.warn('[resolveCanonicalLocationId] Accounts list failed from', accountBase, accountsResponse.status, text.slice(0, 200));
        continue;
      }
      const accountsJson = await accountsResponse.json() as { accounts?: Array<{ name?: string }> };
      const accounts = accountsJson.accounts ?? [];
      console.warn('[resolveCanonicalLocationId] Accounts from', accountBase, ':', accounts.map(a => a.name));

      for (const account of accounts) {
        if (!account.name) continue;
        const locationsResponse = await fetch(
          `${GBP_INFO_BASE}/${account.name}/locations?pageSize=100&readMask=name,metadata`,
          { headers },
        );
        if (!locationsResponse.ok) {
          const text = await locationsResponse.text();
          console.warn('[resolveCanonicalLocationId] Locations list failed for', account.name, ':', locationsResponse.status, text.slice(0, 200));
          continue;
        }
        const locationsJson = await locationsResponse.json() as {
          locations?: Array<{ name?: string; metadata?: { placeId?: string } }>;
        };
        const locations = locationsJson.locations ?? [];
        console.warn('[resolveCanonicalLocationId] Locations for', account.name, ':', locations.map(l => ({ name: l.name, placeId: l.metadata?.placeId })));

        // Prefer matching by Place ID; fall back to first location (single-location accounts)
        const matched =
          locations.find(loc => loc.metadata?.placeId === rawPlaceId) ?? locations[0];

        const canonical = matched?.name ? extractLocationSegment(matched.name) : null;
        if (canonical) {
          console.warn('[resolveCanonicalLocationId] Resolved via enumeration:', canonical);
          return canonical;
        }
      }
    } catch (e) {
      console.warn('[resolveCanonicalLocationId] Enumeration error from', accountBase, ':', e);
    }
  }

  console.error('[resolveCanonicalLocationId] Failed to resolve — returning original:', locationId);
  return locationId;
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
