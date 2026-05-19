/**
 * MSW handlers for Google Business Profile (GBP) Local Posts API.
 * Intercepts HTTP requests to mybusiness.googleapis.com for integration tests.
 *
 * Handlers cover:
 * - Local post creation (Standard, Event, Offer)
 * - OAuth token refresh (just-in-time refresh for 1-hour TTL)
 *
 * Error variant exports allow test-specific overrides via server.use().
 */

import { http, HttpResponse } from 'msw';

const GBP_BASE = 'https://mybusiness.googleapis.com/v4';

export const gbpHandlers = [
  // Create local post (standard, event, offer) — matches /{locationName}/localPosts
  // locationName format: accounts/123/locations/456
  http.post(`${GBP_BASE}/*/localPosts`, () => {
    return HttpResponse.json({
      name: 'accounts/123/locations/456/localPosts/789',
      state: 'LIVE',
    });
  }),

  // Google OAuth2 token refresh (GBP just-in-time token refresh)
  http.post('https://oauth2.googleapis.com/token', () => {
    return HttpResponse.json({
      access_token: 'fresh_gbp_token_12345',
      expires_in: 3600,
      token_type: 'Bearer',
    });
  }),
];

// --- Error handlers for test-specific overrides ---

/** Auth error on GBP local post creation (invalid credentials) */
export const gbpAuthErrorHandler = http.post(
  `${GBP_BASE}/*/localPosts`,
  () => {
    return HttpResponse.json(
      {
        error: {
          code: 401,
          message: 'Request had invalid authentication credentials.',
        },
      },
      { status: 401 },
    );
  },
);

/** Rate limit error on GBP local post creation (quota exceeded) */
export const gbpRateLimitHandler = http.post(
  `${GBP_BASE}/*/localPosts`,
  () => {
    return HttpResponse.json(
      {
        error: {
          code: 429,
          message: 'Quota exceeded',
        },
      },
      { status: 429 },
    );
  },
);
