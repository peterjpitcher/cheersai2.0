import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createManagementSocialPostLinksMock } = vi.hoisted(() => ({ createManagementSocialPostLinksMock: vi.fn() }));
vi.mock('@/lib/management-app/client', () => ({ createManagementSocialPostLinks: createManagementSocialPostLinksMock }));

import { loadManagementConfig, postLinkKey, resolveFacebookPostLinks, shortCodeOf, withPostLink } from '@/lib/content/post-links';

const CONFIG = { baseUrl: 'https://management.example.com', apiKey: 'fixture-management-key' };

beforeEach(() => {
  createManagementSocialPostLinksMock.mockReset();
});

describe('postLinkKey', () => {
  it('names the post by when it goes out, in London time', () => {
    // 10:00 UTC on 26 October is 10:00 GMT; 10:00 UTC on 24 October is 11:00 BST.
    expect(postLinkKey('2026-10-26T10:00:00.000Z')).toBe('post_20261026_1000');
    expect(postLinkKey('2026-10-24T10:00:00.000Z')).toBe('post_20261024_1100');
    // 23:30 UTC on 24 October is already 25 October in London.
    expect(postLinkKey('2026-10-24T23:30:00.000Z')).toBe('post_20261025_0030');
  });

  it('uses now for a post that goes out now', () => {
    expect(postLinkKey(null, new Date('2026-10-23T19:45:00Z'))).toBe('post_20261023_2045');
    expect(postLinkKey('not a date', new Date('2026-10-23T19:45:00Z'))).toBe('post_20261023_2045');
  });
});

describe('shortCodeOf', () => {
  it('reads the code from a short link', () => {
    expect(shortCodeOf('https://l.the-anchor.pub/FB6E761F')).toBe('fb6e761f');
    expect(shortCodeOf('https://www.the-anchor.pub/l/fb6e761f')).toBe('fb6e761f');
  });

  it.each([null, '', 'not a url', 'https://l.the-anchor.pub/', 'https://l.the-anchor.pub/a b'])('returns null for %j', (url) => {
    expect(shortCodeOf(url)).toBeNull();
  });
});

describe('resolveFacebookPostLinks', () => {
  it("asks for one link per post time and maps them back to each slot", async () => {
    createManagementSocialPostLinksMock.mockResolvedValue({
      eventId: 'evt-1',
      parentShortCode: 'fb6e761f',
      variants: [
        { utmContent: 'post_20261026_1100', shortUrl: 'https://l.the-anchor.pub/fp0001', shortCode: 'fp0001', alreadyExists: false },
        { utmContent: 'post_20261029_1100', shortUrl: 'https://l.the-anchor.pub/fp0002', shortCode: 'fp0002', alreadyExists: true },
      ],
    });

    const links = await resolveFacebookPostLinks(CONFIG, {
      facebookLink: 'https://l.the-anchor.pub/fb6e761f',
      slots: [
        { slotKey: 'a', scheduledAt: '2026-10-26T11:00:00.000Z' },
        { slotKey: 'b', scheduledAt: '2026-10-29T11:00:00.000Z' },
        // The same minute as "a": one link serves both.
        { slotKey: 'c', scheduledAt: '2026-10-26T11:00:00.000Z' },
      ],
    });

    expect(createManagementSocialPostLinksMock).toHaveBeenCalledWith(CONFIG, {
      eventShortCode: 'fb6e761f',
      posts: [
        { utmContent: 'post_20261026_1100', name: 'CheersAI Facebook post_20261026_1100' },
        { utmContent: 'post_20261029_1100', name: 'CheersAI Facebook post_20261029_1100' },
      ],
    });
    expect(Object.fromEntries(links)).toEqual({
      a: 'https://l.the-anchor.pub/fp0001',
      b: 'https://l.the-anchor.pub/fp0002',
      c: 'https://l.the-anchor.pub/fp0001',
    });
  });

  it('throws, so the caller keeps the event link, when the link is not a short link or a post gets none', async () => {
    await expect(resolveFacebookPostLinks(CONFIG, { facebookLink: 'not a url', slots: [{ slotKey: 'a', scheduledAt: null }] }))
      .rejects.toThrow('not a short link');

    createManagementSocialPostLinksMock.mockResolvedValue({ eventId: 'evt-1', parentShortCode: 'fb1', variants: [] });
    await expect(resolveFacebookPostLinks(CONFIG, {
      facebookLink: 'https://l.the-anchor.pub/fb1',
      slots: [{ slotKey: 'a', scheduledAt: '2026-10-26T11:00:00.000Z' }],
    })).rejects.toThrow('no link came back for post_20261026_1100');

    createManagementSocialPostLinksMock.mockRejectedValue(new Error('timeout'));
    await expect(resolveFacebookPostLinks(CONFIG, {
      facebookLink: 'https://l.the-anchor.pub/fb1',
      slots: [{ slotKey: 'a', scheduledAt: '2026-10-26T11:00:00.000Z' }],
    })).rejects.toThrow('timeout');
  });
});

describe('loadManagementConfig', () => {
  function db(result: { data: unknown; error: { message: string } | null }) {
    const filters: Array<[string, unknown]> = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      }),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return { client: { from: vi.fn(() => builder) } as never, filters };
  }

  it("reads the brand's own enabled connection", async () => {
    const { client, filters } = db({ data: { base_url: ' https://management.example.com ', api_key: ' key ', enabled: true }, error: null });
    await expect(loadManagementConfig(client, 'acc-1')).resolves.toEqual({ baseUrl: 'https://management.example.com', apiKey: 'key' });
    expect(filters).toEqual([['account_id', 'acc-1']]);
  });

  it('returns null when the connection is missing, off or incomplete, and throws when it cannot be read', async () => {
    await expect(loadManagementConfig(db({ data: null, error: null }).client, 'acc-1')).resolves.toBeNull();
    await expect(loadManagementConfig(db({ data: { base_url: 'https://m', api_key: 'k', enabled: false }, error: null }).client, 'acc-1')).resolves.toBeNull();
    await expect(loadManagementConfig(db({ data: { base_url: 'https://m', api_key: ' ', enabled: true }, error: null }).client, 'acc-1')).resolves.toBeNull();
    await expect(loadManagementConfig(db({ data: null, error: { message: 'timeout' } }).client, 'acc-1')).rejects.toThrow('could not be read: timeout');
  });
});

describe('withPostLink', () => {
  const shared = 'https://l.example.com/fb6e761f';
  const own = 'https://l.example.com/fp0001';

  it('swaps every copy of the shared link and keeps everything else', () => {
    expect(withPostLink(`Book now: ${shared}. Or tap ${shared}!`, shared, own)).toBe(`Book now: ${own}. Or tap ${own}!`);
    expect(withPostLink(`Book: ${shared}`, `  ${shared}  `, own)).toBe(`Book: ${own}`);
    expect(withPostLink('Go https://l.example.com/a+b now', 'https://l.example.com/a+b', own)).toBe(`Go ${own} now`);
  });

  it('leaves a changed, removed or longer link as it is', () => {
    expect(withPostLink('Book at the bar.', shared, own)).toBe('Book at the bar.');
    const longer = `${shared}-vip, ${shared}/more and ${shared}?x=1`;
    expect(withPostLink(longer, shared, own)).toBe(longer);
    expect(withPostLink('https://lXexample.com/fb6e761f', shared, own)).toBe('https://lXexample.com/fb6e761f');
    expect(withPostLink(`Book: ${shared}`, null, own)).toBe(`Book: ${shared}`);
  });
});
