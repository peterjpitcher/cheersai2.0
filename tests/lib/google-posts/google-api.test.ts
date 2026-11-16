import { describe, expect, it, vi } from 'vitest';

import {
  buildLocalPostBody,
  callGoogle,
  londonParts,
  sanitiseGoogleMessage,
  type GoogleVersionForRequest,
} from '@/lib/google-posts/google-api';

/**
 * The request bodies are asserted exactly against fixtures built from Google's
 * reference pages (LocalPost, TimeInterval, Date, TimeOfDay, MediaItem,
 * CallToAction). The suite runs under TZ=Europe/London (npm test) and TZ=UTC
 * (npm run test:utc); the bodies must be identical in both.
 */

const STANDARD: GoogleVersionForRequest = {
  topic_type: 'STANDARD',
  summary: 'Sunday roast is served from noon.',
  cta_type: 'LEARN_MORE',
  cta_url: 'https://l.example.com/roast',
  event_title: null,
  event_start: null,
  event_end: null,
};

const EVENT: GoogleVersionForRequest = {
  topic_type: 'EVENT',
  summary: 'Quiz night this Thursday from 8pm.',
  cta_type: 'BOOK',
  cta_url: 'https://l.example.com/quiz',
  event_title: 'Quiz Night',
  // 20:00 to 22:30 London, a GMT date.
  event_start: '2026-11-19T20:00:00.000Z',
  event_end: '2026-11-19T22:30:00.000Z',
};

describe('buildLocalPostBody', () => {
  it('builds a STANDARD post with a Learn more button and the photo', () => {
    expect(buildLocalPostBody(STANDARD, 'https://storage.example/media/a.jpg?token=x')).toEqual({
      languageCode: 'en-GB',
      summary: 'Sunday roast is served from noon.',
      topicType: 'STANDARD',
      callToAction: { actionType: 'LEARN_MORE', url: 'https://l.example.com/roast' },
      media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://storage.example/media/a.jpg?token=x' }],
    });
  });

  it('builds an EVENT post with London wall-clock times and a Book button', () => {
    expect(buildLocalPostBody(EVENT, null)).toEqual({
      languageCode: 'en-GB',
      summary: 'Quiz night this Thursday from 8pm.',
      topicType: 'EVENT',
      callToAction: { actionType: 'BOOK', url: 'https://l.example.com/quiz' },
      event: {
        title: 'Quiz Night',
        schedule: {
          startDate: { year: 2026, month: 11, day: 19 },
          startTime: { hours: 20, minutes: 0, seconds: 0, nanos: 0 },
          endDate: { year: 2026, month: 11, day: 19 },
          endTime: { hours: 22, minutes: 30, seconds: 0, nanos: 0 },
        },
      },
    });
  });

  it('sends no button when there is no link, or the link is not https', () => {
    expect(buildLocalPostBody({ ...STANDARD, cta_type: null, cta_url: null }, null)).not.toHaveProperty('callToAction');
    expect(buildLocalPostBody({ ...STANDARD, cta_url: 'http://l.example.com/roast' }, null)).not.toHaveProperty('callToAction');
  });

  it('sends a BST event as London time (UTC plus one)', () => {
    const body = buildLocalPostBody({ ...EVENT, event_start: '2026-07-10T18:30:00.000Z', event_end: '2026-07-10T21:00:00.000Z' }, null);
    expect(body.event?.schedule).toEqual({
      startDate: { year: 2026, month: 7, day: 10 },
      startTime: { hours: 19, minutes: 30, seconds: 0, nanos: 0 },
      endDate: { year: 2026, month: 7, day: 10 },
      endTime: { hours: 22, minutes: 0, seconds: 0, nanos: 0 },
    });
  });

  it('handles the night the clocks go back (25 October 2026)', () => {
    // 23:00 BST on 24 October to 02:00 GMT on 25 October: four real hours.
    const body = buildLocalPostBody({ ...EVENT, event_start: '2026-10-24T22:00:00.000Z', event_end: '2026-10-25T02:00:00.000Z' }, null);
    expect(body.event?.schedule).toEqual({
      startDate: { year: 2026, month: 10, day: 24 },
      startTime: { hours: 23, minutes: 0, seconds: 0, nanos: 0 },
      endDate: { year: 2026, month: 10, day: 25 },
      endTime: { hours: 2, minutes: 0, seconds: 0, nanos: 0 },
    });
  });

  it('handles the night the clocks go forward (28 March 2027)', () => {
    // 23:00 GMT on 27 March to 03:00 BST on 28 March: three real hours.
    const body = buildLocalPostBody({ ...EVENT, event_start: '2027-03-27T23:00:00.000Z', event_end: '2027-03-28T02:00:00.000Z' }, null);
    expect(body.event?.schedule).toEqual({
      startDate: { year: 2027, month: 3, day: 27 },
      startTime: { hours: 23, minutes: 0, seconds: 0, nanos: 0 },
      endDate: { year: 2027, month: 3, day: 28 },
      endTime: { hours: 3, minutes: 0, seconds: 0, nanos: 0 },
    });
  });

  it('sends an overnight event as ending on the next date, midnight as 0:00', () => {
    const body = buildLocalPostBody({ ...EVENT, event_start: '2026-12-31T21:00:00.000Z', event_end: '2027-01-01T00:00:00.000Z' }, null);
    expect(body.event?.schedule.endDate).toEqual({ year: 2027, month: 1, day: 1 });
    expect(body.event?.schedule.endTime).toEqual({ hours: 0, minutes: 0, seconds: 0, nanos: 0 });
  });

  it('refuses to build an EVENT with no times', () => {
    expect(() => buildLocalPostBody({ ...EVENT, event_end: null }, null)).toThrow();
  });

  it('gives the same parts whatever the process time zone is', () => {
    expect(londonParts('2026-10-25T00:30:00.000Z')).toEqual({
      date: { year: 2026, month: 10, day: 25 },
      time: { hours: 1, minutes: 30, seconds: 0, nanos: 0 },
    });
    expect(londonParts('2026-10-25T01:30:00.000Z')).toEqual({
      date: { year: 2026, month: 10, day: 25 },
      time: { hours: 1, minutes: 30, seconds: 0, nanos: 0 },
    });
  });
});

describe('sanitiseGoogleMessage', () => {
  it('removes links (the signed image URL) and long tokens, and cuts to 300 characters', () => {
    expect(sanitiseGoogleMessage('Invalid sourceUrl https://storage.example/a.jpg?token=abc for media')).toBe('Invalid sourceUrl [link] for media');
    expect(sanitiseGoogleMessage(`bad ${'x'.repeat(60)}`)).toBe('bad [removed]');
    expect(Array.from(sanitiseGoogleMessage('word '.repeat(200)) ?? '').length).toBeLessThanOrEqual(300);
    expect(sanitiseGoogleMessage(42)).toBeNull();
  });
});

describe('callGoogle', () => {
  it('treats a timeout as no answer (the request may have arrived)', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
      );
      const pending = callGoogle(fetchImpl as unknown as typeof fetch, { method: 'POST', url: 'https://x', accessToken: 't', body: {}, timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ ok: false, kind: 'no_answer' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a refused connection as not sent', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    expect(await callGoogle(fetchImpl as unknown as typeof fetch, { method: 'POST', url: 'https://x', accessToken: 't', timeoutMs: 1000 })).toEqual({
      ok: false,
      kind: 'not_sent',
    });
  });

  it("keeps Google's status and sanitised message for an error answer", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 400, message: 'Bad summary', status: 'INVALID_ARGUMENT' } }), { status: 400 }),
    );
    expect(await callGoogle(fetchImpl as unknown as typeof fetch, { method: 'GET', url: 'https://x', accessToken: 't', timeoutMs: 1000 })).toEqual({
      ok: false,
      kind: 'http',
      status: 400,
      googleStatus: 'INVALID_ARGUMENT',
      message: 'Bad summary',
    });
  });
});
