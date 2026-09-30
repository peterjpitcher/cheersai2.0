/**
 * SiteFooter: the company details and, under them, the Orange Jelly credit,
 * rendered as the server does, with the async credit awaited and its feed
 * answered here rather than over the network.
 */
import type { ReactNode } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// tests/setup.ts stands the fallback line in for the credit in page tests; this renders the real one.
vi.unmock('@/features/marketing/orange-jelly-credit');
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span data-alt={alt} /> }));

const { SiteFooter } = await import('@/features/marketing/site-footer');

/** The HTML once every async component has resolved. */
async function renderAll(node: ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node);
  const chunks: Buffer[] = [];
  for await (const chunk of prelude) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** The credit paragraph straight after the company details, styled like the footer's links. */
function creditAfterCompanyDetails(href: string): RegExp {
  const escaped = href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(
    `</address><p class="mt-2 text-xs leading-relaxed">Built and maintained by <a href="${escaped}" class="[^"]*hover:underline[^"]*">Orange Jelly</a></p>`,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SiteFooter', () => {
  it('shows the fallback credit under the company details while the feed is unreachable', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    const html = await renderAll(<SiteFooter guidesHref={null} />);

    expect(fetchMock).toHaveBeenCalledWith('https://www.orangejelly.co.uk/api/credit/cheers', expect.anything());
    expect(html).toMatch(creditAfterCompanyDetails('https://www.orangejelly.co.uk/'));
    expect(html.match(/company number 10537179/g)).toHaveLength(1);
  });

  it('shows the line the feed gives when it answers', async () => {
    const feed = {
      prefix: 'Built and maintained by',
      label: 'Orange Jelly',
      href: 'https://www.orangejelly.co.uk/solutions/hospitality-websites',
      nofollow: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(feed)),
    );

    const html = await renderAll(<SiteFooter guidesHref={null} />);

    expect(html).toMatch(creditAfterCompanyDetails(feed.href));
    expect(html).not.toContain('rel="nofollow"');
  });
});
