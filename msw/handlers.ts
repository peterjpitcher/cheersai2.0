import { http, HttpResponse } from 'msw'

export const handlers = [
  // Minimal Graph placeholders to prevent network errors in dev
  http.post('https://graph.facebook.com/*', () => HttpResponse.json({ id: 'mock_1' })),
]
