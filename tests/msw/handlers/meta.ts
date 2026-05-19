/**
 * MSW handlers for Meta Graph API (Facebook + Instagram).
 * Intercepts HTTP requests to graph.facebook.com for integration tests.
 *
 * Handlers cover:
 * - Facebook: page feed post, page photo, page story
 * - Instagram: container creation (step 1), media publish (step 2), carousel child
 *
 * Error variant exports allow test-specific overrides via server.use().
 */

import { http, HttpResponse } from 'msw';

const GRAPH_BASE = 'https://graph.facebook.com';

export const metaHandlers = [
  // Facebook page post (text-only feed)
  http.post(`${GRAPH_BASE}/*/feed`, () => {
    return HttpResponse.json({ id: '12345_67890' });
  }),

  // Facebook page photo post
  http.post(`${GRAPH_BASE}/*/photos`, () => {
    return HttpResponse.json({ id: 'photo_123', post_id: '12345_photo_123' });
  }),

  // Facebook page story (photo_stories endpoint)
  http.post(`${GRAPH_BASE}/*/photo_stories`, () => {
    return HttpResponse.json({ id: 'story_123' });
  }),

  // Instagram container creation (step 1) and carousel child creation
  // Both use /{ig-user-id}/media endpoint
  http.post(`${GRAPH_BASE}/*/media`, () => {
    return HttpResponse.json({ id: 'container_123' });
  }),

  // Instagram publish (step 2) — /{ig-user-id}/media_publish
  http.post(`${GRAPH_BASE}/*/media_publish`, () => {
    return HttpResponse.json({ id: 'ig_post_456' });
  }),
];

// --- Error handlers for test-specific overrides ---

/** Auth error on Facebook feed post (expired OAuth token) */
export const metaAuthErrorHandler = http.post(`${GRAPH_BASE}/*/feed`, () => {
  return HttpResponse.json(
    {
      error: {
        message: 'Invalid OAuth 2.0 Access Token',
        type: 'OAuthException',
        code: 190,
        error_subcode: 463,
      },
    },
    { status: 401 },
  );
});

/** Rate limit error on Facebook feed post */
export const metaRateLimitHandler = http.post(`${GRAPH_BASE}/*/feed`, () => {
  return HttpResponse.json(
    {
      error: {
        message: 'Rate limit exceeded',
        type: 'OAuthException',
        code: 32,
      },
    },
    { status: 429 },
  );
});

/** Content rejected error on Facebook feed post */
export const metaContentRejectedHandler = http.post(`${GRAPH_BASE}/*/feed`, () => {
  return HttpResponse.json(
    {
      error: {
        message: 'Content violates community standards',
        type: 'OAuthException',
        code: 100,
      },
    },
    { status: 400 },
  );
});

/** Auth error on Instagram container creation (step 1) */
export const metaIgAuthErrorHandler = http.post(`${GRAPH_BASE}/*/media`, () => {
  return HttpResponse.json(
    {
      error: {
        message: 'Invalid OAuth 2.0 Access Token',
        type: 'OAuthException',
        code: 190,
        error_subcode: 463,
      },
    },
    { status: 401 },
  );
});
