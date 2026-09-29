// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GUIDES_SEO, HOME_SEO } from '@/content/seo';
import { RESERVED_ANCHORS } from '@/lib/guides/define-guide';

import { planningGuide, SAMPLE_GUIDES, storiesGuide } from '../../../tests/fixtures/guides/sample-guides';

/**
 * /guides and /guides/<slug> (SPEC-homepage-and-guides §3): public whatever
 * the sign-up switch says, and not found (with nothing new in the metadata)
 * only while there are no guides or for an unknown slug. The index groups
 * guides by category and each guide has its metadata, JSON-LD, table of
 * contents, London-time updated date, related guides and a call to action
 * that follows the switch.
 */
const mocks = vi.hoisted(() => ({
  switchState: vi.fn(),
  serverEnv: { VERCEL_ENV: 'production' } as Record<string, string>,
  guides: [] as import('@/content/guides/types').Guide[],
}));

vi.mock('@/env', () => ({
  env: { server: mocks.serverEnv, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } },
}));
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mocks.switchState() }));
vi.mock('@/content/guides', () => ({ listGuides: () => mocks.guides }));

const indexPage = await import('@/app/guides/page');
const guidePage = await import('@/app/guides/[slug]/page');

const SITE = 'https://cheers.orangejelly.co.uk';

function paramsFor(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

/** Next's notFound() throws an error whose digest names the 404 fallback. */
async function isNotFound(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
  } catch (error) {
    return ((error as { digest?: string }).digest ?? '').startsWith('NEXT_HTTP_ERROR_FALLBACK;404');
  }
  return false;
}

function jsonLd(container: HTMLElement): Record<string, unknown>[] {
  return Array.from(container.querySelectorAll('script[type="application/ld+json"]')).map(
    (script) => JSON.parse(script.textContent ?? '{}') as Record<string, unknown>,
  );
}

function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverEnv.VERCEL_ENV = 'production';
  mocks.guides = SAMPLE_GUIDES;
});
afterEach(cleanup);

describe('while sign-up is closed, or the switch cannot be read', () => {
  it.each(['closed', 'enforcement_off', 'unavailable'])('every guide is public, with Talk to us (switch %s)', async (state) => {
    mocks.switchState.mockResolvedValue(state);

    const index = render(await indexPage.default());
    expect(index.container.querySelector('h1')?.textContent).toBe(GUIDES_SEO.heading);
    for (const guide of SAMPLE_GUIDES) expect(hrefs(index.container)).toContain(`/guides/${guide.slug}`);
    cleanup();

    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe(planningGuide.title);
    expect(text).toContain('Talk to us');
    expect(text).not.toContain('Start your free trial');
    expect(hrefs(container)).not.toContain('/signup');
    expect(container.innerHTML).toContain('href="mailto:peter@orangejelly.co.uk"');
  });

  it('may be indexed, with metadata that never reads the switch', async () => {
    mocks.switchState.mockResolvedValue('closed');
    const guideMeta = await guidePage.generateMetadata(paramsFor(planningGuide.slug));
    expect(guideMeta.title).toBe('Plan a week of pub social media posts | Cheers');
    expect(guideMeta.robots).toEqual({ index: true, follow: true });
    expect((await indexPage.generateMetadata()).robots).toEqual({ index: true, follow: true });
    expect(mocks.switchState).not.toHaveBeenCalled();
  });

  it('shows the same on a Vercel Preview as in production', async () => {
    mocks.serverEnv.VERCEL_ENV = 'preview';
    mocks.switchState.mockResolvedValue('closed');
    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    expect(container.textContent).toContain('Talk to us');
  });
});

describe('while there are no guides, or for a slug that is not a guide', () => {
  it('the page is not found and carries nothing new', async () => {
    mocks.switchState.mockResolvedValue('open');
    expect(await isNotFound(() => guidePage.default(paramsFor('no-such-guide')))).toBe(true);
    expect(await guidePage.generateMetadata(paramsFor('no-such-guide'))).toEqual({});

    mocks.guides = [];
    expect(await isNotFound(() => indexPage.default())).toBe(true);
    expect(await indexPage.generateMetadata()).toEqual({});
    expect(guidePage.generateStaticParams()).toEqual([]);
  });
});

describe('/guides while sign-up is open', () => {
  beforeEach(() => mocks.switchState.mockResolvedValue('open'));

  it('groups the guides by category, in category order, and links each one', async () => {
    const { container } = render(await indexPage.default());

    const headings = Array.from(container.querySelectorAll('h2')).map((heading) => heading.textContent);
    expect(headings.indexOf('Planning your posts')).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf('Planning your posts')).toBeLessThan(headings.indexOf('Photos and video'));
    expect(container.querySelector('h1')?.textContent).toBe(GUIDES_SEO.heading);
    for (const guide of SAMPLE_GUIDES) expect(hrefs(container)).toContain(`/guides/${guide.slug}`);
  });

  it('marks Guides in the header as the current page', async () => {
    const { container } = render(await indexPage.default());
    expect(container.querySelector('header a[href="/guides"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('lists the guides in ItemList JSON-LD in the order the page shows them', async () => {
    const { container } = render(await indexPage.default());
    const itemList = jsonLd(container).find((item) => item['@type'] === 'ItemList');

    expect(itemList?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, url: `${SITE}/guides/${planningGuide.slug}`, name: planningGuide.title },
      { '@type': 'ListItem', position: 2, url: `${SITE}/guides/${storiesGuide.slug}`, name: storiesGuide.title },
    ]);
  });

  it('has its own title, description and canonical URL, and may be indexed', async () => {
    const metadata = await indexPage.generateMetadata();

    expect(metadata.title).toBe(GUIDES_SEO.title);
    expect(metadata.description).toBe(GUIDES_SEO.description);
    expect(metadata.alternates?.canonical).toBe(`${SITE}/guides`);
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it('shares the homepage picture, described in the same words', async () => {
    const metadata = await indexPage.generateMetadata();
    const image = { url: `${SITE}/og`, width: 1200, height: 630, alt: HOME_SEO.imageAlt };

    expect(metadata.openGraph).toMatchObject({ images: [image] });
    expect(metadata.twitter).toMatchObject({ images: [image] });
  });
});

describe('a guide while sign-up is open', () => {
  beforeEach(() => mocks.switchState.mockResolvedValue('open'));

  it('lists every guide for generateStaticParams', () => {
    expect(guidePage.generateStaticParams()).toEqual(SAMPLE_GUIDES.map((guide) => ({ slug: guide.slug })));
  });

  it('uses "<title> | Cheers" as the page title when a guide has no search title of its own', async () => {
    const metadata = await guidePage.generateMetadata(paramsFor(storiesGuide.slug));
    expect(metadata.title).toBe(`${storiesGuide.title} | Cheers`);
  });

  it('is not found for a slug that is not a guide', async () => {
    expect(await isNotFound(() => guidePage.default(paramsFor('no-such-guide')))).toBe(true);
    expect(await guidePage.generateMetadata(paramsFor('no-such-guide'))).toEqual({});
  });

  it('has its title, description, canonical URL, share cards and keywords, and may be indexed', async () => {
    const metadata = await guidePage.generateMetadata(paramsFor(planningGuide.slug));
    const url = `${SITE}/guides/${planningGuide.slug}`;
    const image = { url: `${SITE}/og/guides/${planningGuide.slug}`, width: 1200, height: 630, alt: planningGuide.title };

    expect(metadata.title).toBe('Plan a week of pub social media posts | Cheers');
    expect(metadata.description).toBe(planningGuide.description);
    expect(metadata.alternates?.canonical).toBe(url);
    expect(metadata.keywords).toEqual([planningGuide.primaryKeyword, ...planningGuide.secondaryKeywords]);
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({
      type: 'article',
      url,
      publishedTime: planningGuide.published,
      modifiedTime: planningGuide.updated,
      images: [image],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [image] });
  });

  it('renders the body blocks, a table of contents from the H2s and the updated date in London time', async () => {
    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    const text = container.textContent ?? '';

    expect(container.querySelector('h1')?.textContent).toBe(planningGuide.title);
    expect(text).toContain(planningGuide.summary);
    expect(text).toContain('Updated 29 September 2026');
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-29');
    expect(text).toContain(`${planningGuide.readingMinutes} min read`);

    const contents = Array.from(container.querySelectorAll('nav[aria-labelledby="guide-contents-title"] a'));
    expect(contents.map((link) => [link.textContent, link.getAttribute('href')])).toEqual(
      planningGuide.sections.map((section) => [section.heading, `#${section.id}`]),
    );
    for (const section of planningGuide.sections) {
      expect(container.querySelector(`h2[id="${section.id}"]`)?.textContent).toBe(section.heading);
    }
    expect(container.querySelector('ol.list-decimal')?.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('[role="note"]')?.textContent).toContain('Keep a note on your phone');
    expect(container.querySelector('strong')?.textContent).toBe('People');
    expect(container.querySelectorAll('h3').length).toBeGreaterThanOrEqual(2);
  });

  it('marks Guides in the header as the current section', async () => {
    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    expect(container.querySelector('header a[href="/guides"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('uses each id once, and only the reserved ones besides its section anchors', async () => {
    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    const ids = Array.from(container.querySelectorAll('[id]')).map((element) => element.id);
    const sectionIds = new Set(planningGuide.sections.map((section) => section.id));

    expect(new Set(ids).size).toBe(ids.length);
    // A new id on the page must join RESERVED_ANCHORS, so no guide can reuse it.
    expect(ids.filter((id) => !sectionIds.has(id)).sort()).toEqual([...RESERVED_ANCHORS].sort());
  });

  it('describes itself in Article and BreadcrumbList JSON-LD', async () => {
    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    const items = jsonLd(container);
    const url = `${SITE}/guides/${planningGuide.slug}`;

    expect(items.find((item) => item['@type'] === 'Article')).toMatchObject({
      headline: planningGuide.title,
      description: planningGuide.description,
      url,
      mainEntityOfPage: url,
      datePublished: '2026-09-01',
      dateModified: '2026-09-29',
      articleSection: 'Planning your posts',
      wordCount: planningGuide.wordCount,
      image: `${SITE}/og/guides/${planningGuide.slug}`,
      author: { '@type': 'Organization', name: 'Orange Jelly Limited' },
    });
    expect(items.find((item) => item['@type'] === 'BreadcrumbList')?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE}/guides` },
      { '@type': 'ListItem', position: 3, name: planningGuide.title, item: url },
    ]);
  });

  it('suggests related guides, never itself, and links inside the body', async () => {
    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    const related = container.querySelector('section[aria-labelledby="related-title"]');

    expect(related?.querySelectorAll('article')).toHaveLength(1);
    expect(related?.querySelector('a')?.getAttribute('href')).toBe(`/guides/${storiesGuide.slug}`);
    expect(related?.innerHTML).not.toContain(`/guides/${planningGuide.slug}"`);
  });

  it('offers the free trial and the homepage in its call to action, and links the guides', async () => {
    const { container } = render(await guidePage.default(paramsFor(planningGuide.slug)));
    const text = container.textContent ?? '';

    expect(text).toContain(planningGuide.closing.heading);
    expect(text).toContain('Start your free trial');
    expect(text).not.toContain('Talk to us');
    expect(hrefs(container)).toEqual(expect.arrayContaining(['/signup', '/', '/guides', '/login']));
    expect(container.innerHTML).not.toContain(String.fromCharCode(0x2014));
    for (const bad of ['undefined', 'NaN', 'Invalid Date', 'null']) expect(text).not.toContain(bad);
  });
});
