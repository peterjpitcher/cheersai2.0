import { describe, expect, it, vi } from 'vitest';

import {
  CRAWLABLE_FILES,
  frontDoorCta,
  frontDoorVisible,
  guidesVisibility,
  indexableWhenOpen,
  robotsFor,
} from '@/lib/signup/front-door';

import { SAMPLE_GUIDES } from '../../../tests/fixtures/guides/sample-guides';

// Hoisted above the imports by Vitest: absolute URLs use the canonical host.
vi.mock('@/env', () => ({
  env: { server: {}, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } },
}));

const PRODUCTION = { vercelEnv: 'production', nodeEnv: 'production' };
const PREVIEW = { vercelEnv: 'preview', nodeEnv: 'production' };
const LOCAL_DEV = { vercelEnv: undefined, nodeEnv: 'development' };

describe('robots.txt', () => {
  it('disallows everything while the switch is off, unreadable or on without billing enforcement, as before, and names no sitemap', () => {
    for (const state of ['closed', 'enforcement_off', 'unavailable'] as const) {
      expect(robotsFor(state)).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
    }
  });

  it('allows the home page, the legal pages, the guides and the files they need once the switch is on, and names the sitemap', () => {
    expect(robotsFor('open')).toEqual({
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
    const allow = robotsFor('open').rules;
    const allowed = (Array.isArray(allow) ? allow : [allow]).flatMap((rule) => rule.allow ?? []);
    for (const path of ['/planner', '/signup', '/login', '/help', '/settings', '/auth']) {
      expect(allowed.some((prefix) => prefix !== '/$' && path.startsWith(prefix)), path).toBe(false);
    }
  });
});

describe('who sees the landing page', () => {
  it('in production, only signed-out visitors while the switch is on', () => {
    expect(frontDoorVisible('open', PRODUCTION)).toBe(true);
    expect(frontDoorVisible('closed', PRODUCTION)).toBe(false);
    expect(frontDoorVisible('unavailable', PRODUCTION)).toBe(false);
    expect(frontDoorVisible('enforcement_off', PRODUCTION)).toBe(false);
    // Off Vercel with a production build (for example `next start`): closed stays closed.
    expect(frontDoorVisible('closed', { nodeEnv: 'production' })).toBe(false);
  });

  it('on a Vercel Preview or a local dev server whatever the switch, so the copy can be approved', () => {
    expect(frontDoorVisible('closed', PREVIEW)).toBe(true);
    expect(frontDoorVisible('unavailable', LOCAL_DEV)).toBe(true);
  });
});

describe('who sees the guides', () => {
  it('in production, everyone once the switch is on and a guide exists; nobody while it is off', () => {
    expect(guidesVisibility('open', SAMPLE_GUIDES, PRODUCTION)).toBe('visible');
    expect(guidesVisibility('closed', SAMPLE_GUIDES, PRODUCTION)).toBe('hidden');
    expect(guidesVisibility('closed', SAMPLE_GUIDES, { nodeEnv: 'production' })).toBe('hidden');
  });

  it('in production, a temporary error rather than "not found" when the switch cannot be read', () => {
    expect(guidesVisibility('unavailable', SAMPLE_GUIDES, PRODUCTION)).toBe('unavailable');
  });

  it('on a Vercel Preview or a local dev server whatever the switch, so article copy can be approved', () => {
    for (const state of ['open', 'closed', 'unavailable'] as const) {
      expect(guidesVisibility(state, SAMPLE_GUIDES, PREVIEW), state).toBe('visible');
      expect(guidesVisibility(state, SAMPLE_GUIDES, LOCAL_DEV), state).toBe('visible');
    }
  });

  it('never while there are no guides, whatever the switch and wherever', () => {
    for (const state of ['open', 'closed', 'unavailable'] as const) {
      for (const deployment of [PRODUCTION, PREVIEW, LOCAL_DEV]) {
        expect(guidesVisibility(state, [], deployment), state).toBe('hidden');
      }
    }
  });
});

describe('the call to action', () => {
  it('offers the free trial only when the switch is on; otherwise "Talk to us"', () => {
    expect(frontDoorCta('open')).toBe('trial');
    expect(frontDoorCta('closed')).toBe('talk');
    expect(frontDoorCta('unavailable')).toBe('talk');
    expect(frontDoorCta('enforcement_off')).toBe('talk');
  });
});

describe('page indexing', () => {
  const base = { title: 'Terms of Service | Cheers' };

  it('lifts the site-wide noindex only while the switch is on', () => {
    expect(indexableWhenOpen(base, 'open')).toEqual({ ...base, robots: { index: true, follow: true } });
    expect(indexableWhenOpen(base, 'closed')).toEqual(base);
    expect(indexableWhenOpen(base, 'unavailable')).toEqual(base);
    expect(indexableWhenOpen(base, 'enforcement_off')).toEqual(base);
  });
});
