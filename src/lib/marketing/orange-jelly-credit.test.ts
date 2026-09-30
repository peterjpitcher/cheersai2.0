import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  FALLBACK_CREDIT,
  getOrangeJellyCredit,
  parseOrangeJellyCredit,
} from '@/lib/marketing/orange-jelly-credit';

/** What orangejelly.co.uk publishes for this site. */
const FEED = {
  prefix: 'Built and maintained by',
  label: 'Orange Jelly',
  href: 'https://www.orangejelly.co.uk/solutions/hospitality-websites',
  nofollow: false,
};

const FEED_LINE = {
  prefix: 'Built and maintained by',
  label: 'Orange Jelly',
  href: 'https://www.orangejelly.co.uk/solutions/hospitality-websites',
};

describe('parseOrangeJellyCredit', () => {
  it('accepts the feed answer, trimmed', () => {
    expect(parseOrangeJellyCredit(FEED)).toEqual(FEED_LINE);
    expect(parseOrangeJellyCredit({ ...FEED, prefix: ' Built by ', label: ' Orange Jelly ' })).toMatchObject({
      prefix: 'Built by',
      label: 'Orange Jelly',
    });
  });

  it('allows an empty prefix, and text up to 80 characters', () => {
    expect(parseOrangeJellyCredit({ ...FEED, prefix: '' })).toEqual({ ...FEED_LINE, prefix: '' });
    expect(parseOrangeJellyCredit({ ...FEED, prefix: 'p'.repeat(80), label: 'l'.repeat(80) })).not.toBeNull();
  });

  it.each([
    ['a missing label', { ...FEED, label: undefined }],
    ['an empty label', { ...FEED, label: '' }],
    ['a blank label', { ...FEED, label: '   ' }],
    ['a missing prefix', { ...FEED, prefix: undefined }],
    ['a label over 80 characters', { ...FEED, label: 'l'.repeat(81) }],
    ['a prefix over 80 characters', { ...FEED, prefix: 'p'.repeat(81) }],
    ['a missing link', { ...FEED, href: undefined }],
    ['a link that is not a URL', { ...FEED, href: 'not a link' }],
    ['a plain HTTP link', { ...FEED, href: 'http://www.orangejelly.co.uk/' }],
    ['a link to another host', { ...FEED, href: 'https://example.com/' }],
    ['a link to the bare domain', { ...FEED, href: 'https://orangejelly.co.uk/' }],
    ['a link to a look-alike host', { ...FEED, href: 'https://www.orangejelly.co.uk.evil.test/' }],
    ['a link with credentials', { ...FEED, href: 'https://user:secret@www.orangejelly.co.uk/' }],
    ['a link with a username', { ...FEED, href: 'https://user@www.orangejelly.co.uk/' }],
  ])('rejects %s', (_case, data) => {
    expect(parseOrangeJellyCredit(data)).toBeNull();
  });

  it.each([null, undefined, 'Built and maintained by Orange Jelly', 42, true, []])(
    'rejects %j, which is not an object',
    (data) => {
      expect(parseOrangeJellyCredit(data)).toBeNull();
    },
  );

  it('gives rel="nofollow" only when nofollow is exactly true', () => {
    expect(parseOrangeJellyCredit({ ...FEED, nofollow: true })).toEqual({ ...FEED_LINE, rel: 'nofollow' });
    for (const nofollow of [false, 'true', 1, null, undefined]) {
      expect(parseOrangeJellyCredit({ ...FEED, nofollow })).not.toHaveProperty('rel');
    }
  });
});

describe('getOrangeJellyCredit', () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    // The fallback path warns by design; keep the expected warning out of the output.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch(answer: (...args: Parameters<typeof fetch>) => Promise<Response>) {
    const fetchMock = vi.fn<typeof fetch>(answer);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns the feed line when the feed answers 200 with a valid body', async () => {
    stubFetch(async () => Response.json({ ...FEED, nofollow: true }));
    await expect(getOrangeJellyCredit()).resolves.toEqual({ ...FEED_LINE, rel: 'nofollow' });
    expect(warn).not.toHaveBeenCalled();
  });

  it("asks for this site's feed, cached for a day, with a timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = stubFetch(async () => Response.json(FEED));
    await getOrangeJellyCredit();
    expect(fetchMock).toHaveBeenCalledWith('https://www.orangejelly.co.uk/api/credit/cheers', {
      next: { revalidate: 86400 },
      signal: expect.any(AbortSignal),
    });
    expect(timeout).toHaveBeenCalledWith(3000);
  });

  it('falls back when the feed answers anything but 200', async () => {
    stubFetch(async () => new Response('Not found', { status: 404 }));
    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT);
    expect(warn).toHaveBeenCalledWith('[orange-jelly-credit] showing the fallback line:', expect.any(Error));
  });

  it('falls back when the network fails', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('falls back when the feed times out', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
      AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(signal.reason);
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('falls back when the feed answers with a foreign link or a body that is not JSON', async () => {
    stubFetch(async () => Response.json({ ...FEED, href: 'https://example.com/' }));
    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT);

    stubFetch(async () => new Response('<!doctype html>', { status: 200 }));
    await expect(getOrangeJellyCredit()).resolves.toEqual(FALLBACK_CREDIT);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('rethrows the errors Next.js uses to signal dynamic rendering and redirects', async () => {
    const signal = Object.assign(new Error('Dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' });
    stubFetch(async () => {
      throw signal;
    });
    await expect(getOrangeJellyCredit()).rejects.toBe(signal);
    expect(warn).not.toHaveBeenCalled();
  });
});
