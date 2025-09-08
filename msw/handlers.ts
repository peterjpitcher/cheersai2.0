import { http, HttpResponse } from 'msw'

export const handlers = [
  // Minimal Graph placeholders to prevent network errors in dev
  http.post('https://graph.facebook.com/*', () => HttpResponse.json({ id: 'mock_1' })),
  http.post('https://upload.twitter.com/1.1/media/upload.json', () => HttpResponse.json({ media_id_string: 'm1' })),
  http.post('https://api.twitter.com/2/tweets', () => HttpResponse.json({ data: { id: 't1' } })),
]

