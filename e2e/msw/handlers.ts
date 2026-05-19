/**
 * MSW handlers for staging E2E environment.
 * Extends Phase 4 patterns: wildcard paths, platform-specific responses.
 * These handlers intercept external API calls during E2E tests.
 */
import { http, HttpResponse } from 'msw';

export const handlers = [
  // Facebook Graph API - post creation
  http.post('*/v21.0/:pageId/feed', () => {
    return HttpResponse.json({ id: 'e2e_fb_post_123' });
  }),

  // Facebook Graph API - story creation
  http.post('*/v21.0/:pageId/photos', () => {
    return HttpResponse.json({ id: 'e2e_fb_photo_123' });
  }),

  // Instagram Content Publishing - create container
  http.post('*/v21.0/:userId/media', () => {
    return HttpResponse.json({ id: 'e2e_ig_container_123' });
  }),

  // Instagram Content Publishing - publish container
  http.post('*/v21.0/:userId/media_publish', () => {
    return HttpResponse.json({ id: 'e2e_ig_post_123' });
  }),

  // GBP - create local post
  http.post('*/v1/accounts/:accountId/locations/:locationId/localPosts', () => {
    return HttpResponse.json({
      name: 'accounts/123/locations/456/localPosts/e2e_gbp_post_123',
      state: 'LIVE',
    });
  }),

  // OpenAI - chat completion (for AI generation in create flow)
  http.post('*/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [{
        message: {
          content: JSON.stringify({
            facebook: { body: 'E2E test Facebook copy', hashtags: ['#test'] },
            instagram: { body: 'E2E test Instagram copy', hashtags: ['#test'] },
            gbp: { body: 'E2E test GBP copy', cta: { type: 'LEARN_MORE', url: 'https://example.com' } },
          }),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    });
  }),

  // Resend - email sending (mock to prevent real email delivery)
  http.post('*/emails', () => {
    return HttpResponse.json({ id: 'e2e_email_123' });
  }),
];
