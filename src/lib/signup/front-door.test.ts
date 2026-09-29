import { describe, expect, it, vi } from 'vitest';

import { CRAWLABLE_FILES, frontDoorCta, indexable, publicRobots } from '@/lib/signup/front-door';

// Hoisted above the imports by Vitest: absolute URLs use the canonical host.
vi.mock('@/env', () => ({
  env: { server: {}, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } },
}));

describe('robots.txt', () => {
  it('allows the home page, the legal pages, the guides and the files they need, and names the sitemap', () => {
    expect(publicRobots()).toEqual({
      rules: [
        {
          userAgent: '*',
          allow: ['/$', '/terms', '/privacy', '/data-processing', '/guides', ...CRAWLABLE_FILES],
          disallow: '/',
        },
      ],
      sitemap: 'https://cheers.orangejelly.co.uk/sitemap.xml',
    });
  });

  it('opens only files, never other pages such as the app or sign-up', () => {
    expect(CRAWLABLE_FILES).toEqual([
      '/_next/static/',
      '/_next/image',
      '/brand/',
      '/og',
      '/favicon.ico',
      '/icon.png',
      '/apple-icon.png',
      '/sitemap.xml',
    ]);
    const rules = publicRobots().rules;
    const allowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => rule.allow ?? []);
    for (const path of ['/planner', '/signup', '/login', '/help', '/settings', '/auth']) {
      expect(allowed.some((prefix) => prefix !== '/$' && path.startsWith(prefix)), path).toBe(false);
    }
  });
});

describe('the call to action', () => {
  it('offers the free trial only when sign-up is open; otherwise "Talk to us"', () => {
    expect(frontDoorCta('open')).toBe('trial');
    for (const state of ['closed', 'enforcement_off', 'unavailable'] as const) expect(frontDoorCta(state)).toBe('talk');
  });
});

describe('page indexing', () => {
  it('lifts the site-wide noindex for a public page', () => {
    const base = { title: 'Terms of Service | Cheers' };
    expect(indexable(base)).toEqual({ ...base, robots: { index: true, follow: true } });
  });
});
