import type { MetadataRoute } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { guideMetadata, homeMetadata } from '@/lib/marketing/metadata';
import { sitemapFor } from '@/lib/marketing/sitemap';
import { articleJsonLd, organizationJsonLd } from '@/lib/marketing/structured-data';
import { robotsFor } from '@/lib/signup/front-door';

import { SAMPLE_GUIDES } from '../../../tests/fixtures/guides/sample-guides';
import { headersFor } from '../../../tests/helpers/security-headers';

/**
 * Once the sign-up switch is on, robots.txt, the sitemap, the structured data
 * and the X-Robots-Tag header must agree: everything the sitemap lists and
 * every image the structured data names can be fetched and indexed, the
 * sitemap itself can be fetched, and the app stays closed. Checked with
 * Google's own robots.txt matching, so the allow list and the sitemap cannot
 * drift apart (SPEC-homepage-and-guides §3 and §4).
 */

vi.mock('@/env', () => ({
  env: { server: {}, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } },
}));

interface RobotsGroup {
  allow: string[];
  disallow: string[];
}

/** The robots.txt group that applies to every crawler ("User-agent: *"). */
function everyCrawler(robots: MetadataRoute.Robots): RobotsGroup {
  const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
  const group = rules.find((rule) => [rule.userAgent].flat().includes('*'));
  const list = (value: string | string[] | undefined): string[] => (value === undefined ? [] : [value].flat());
  return { allow: list(group?.allow), disallow: list(group?.disallow) };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Google's rule matching: from the start of the path, `*` matches anything and a final `$` ends the match. */
function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = body.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

/**
 * Whether Googlebot may fetch a path: the longest matching rule wins, and
 * allow wins a tie; with no matching rule the path is allowed (Google's
 * robots.txt specification).
 */
function googleMayCrawl(group: RobotsGroup, path: string): boolean {
  const longest = (rules: string[]): number =>
    Math.max(-1, ...rules.filter((rule) => ruleMatches(rule, path)).map((rule) => rule.length));
  return longest(group.allow) >= longest(group.disallow);
}

function pathOf(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

/** The URL string at a path inside a JSON-LD object, for example ['publisher', 'logo', 'url']. */
function jsonLdUrl(data: unknown, keys: readonly string[]): string {
  const value = keys.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], data);
  if (typeof value !== 'string') throw new Error(`no URL at ${keys.join('.')}`);
  return value;
}

/** The first share image URL in page metadata. */
function shareImageUrl(metadata: ReturnType<typeof homeMetadata>): string {
  const images = [metadata.openGraph?.images ?? []].flat();
  const first = images[0];
  const url = typeof first === 'string' || first instanceof URL ? first : first?.url;
  if (!url) throw new Error('no share image');
  return url.toString();
}

const OPEN = robotsFor('open');
const GROUP = everyCrawler(OPEN);

describe('once the sign-up switch is on', () => {
  it('robots.txt lets search engines fetch the sitemap it names', () => {
    expect(OPEN.sitemap).toBe('https://cheers.orangejelly.co.uk/sitemap.xml');
    expect(googleMayCrawl(GROUP, pathOf(String(OPEN.sitemap)))).toBe(true);
  });

  it('every page in the sitemap can be crawled and carries no X-Robots-Tag', () => {
    const pages = sitemapFor('open', SAMPLE_GUIDES).map((entry) => pathOf(entry.url));
    expect(pages).toEqual(expect.arrayContaining(['/', '/guides', '/terms', `/guides/${SAMPLE_GUIDES[0].slug}`]));
    for (const path of pages) {
      expect(googleMayCrawl(GROUP, path), path).toBe(true);
      expect(headersFor(path)['X-Robots-Tag'], path).toBeUndefined();
    }
  });

  it('the logo and share images the pages name can be crawled and indexed', () => {
    const images = [
      jsonLdUrl(organizationJsonLd(), ['logo']),
      shareImageUrl(homeMetadata()),
      ...SAMPLE_GUIDES.flatMap((guide) => [
        jsonLdUrl(articleJsonLd(guide), ['image']),
        jsonLdUrl(articleJsonLd(guide), ['publisher', 'logo', 'url']),
        shareImageUrl(guideMetadata(guide)),
      ]),
    ].map(pathOf);
    expect(images).toEqual(expect.arrayContaining(['/brand/cheers-icon-512.png', '/og', `/og/guides/${SAMPLE_GUIDES[0].slug}`]));
    for (const path of images) {
      expect(googleMayCrawl(GROUP, path), path).toBe(true);
      expect(headersFor(path)['X-Robots-Tag'], path).toBeUndefined();
    }
  });

  it('the app, sign-up, sign-in, help and the API stay closed to crawlers', () => {
    for (const path of ['/planner', '/signup', '/login', '/help', '/settings', '/auth/confirm', '/api/cron/publish-scheduler', '/l/the-anchor']) {
      expect(googleMayCrawl(GROUP, path), path).toBe(false);
    }
  });
});

describe('while the sign-up switch is off', () => {
  it('robots.txt lets search engines fetch nothing', () => {
    const closed = everyCrawler(robotsFor('closed'));
    for (const path of ['/', '/sitemap.xml', '/guides', '/og', '/brand/cheers-icon-512.png', '/terms']) {
      expect(googleMayCrawl(closed, path), path).toBe(false);
    }
  });
});

describe('the robots.txt matcher itself', () => {
  it('follows Google: longest rule wins, allow wins a tie, $ ends a rule', () => {
    const group = { allow: ['/$', '/guides', '/p*.png'], disallow: ['/', '/guides/secret'] };
    expect(googleMayCrawl(group, '/')).toBe(true);
    expect(googleMayCrawl(group, '/x')).toBe(false);
    expect(googleMayCrawl(group, '/guides/a')).toBe(true);
    expect(googleMayCrawl(group, '/guides/secret')).toBe(false);
    expect(googleMayCrawl(group, '/photo.png')).toBe(true);
    expect(googleMayCrawl({ allow: ['/a'], disallow: ['/a'] }, '/a')).toBe(true);
    expect(googleMayCrawl({ allow: [], disallow: [] }, '/anything')).toBe(true);
  });
});
