import { describe, expect, it } from 'vitest';

import { INDEXABLE_PATHS, INDEXABLE_SECTIONS } from '@/lib/security/headers';

import { headersFor } from '../../helpers/security-headers';

const NOT_INDEXABLE = [
  '/login',
  '/planner',
  '/settings',
  '/signup',
  '/auth/confirm',
  '/help',
  '/api/cron/publish-scheduler',
  '/l/the-anchor',
  '/robots.txt',
  '/terms/old',
  '/terms-and-conditions',
  '/privacy-policy',
  '/data-processing/annex',
  '/_next/static/chunk.js',
  '/guides-old',
  '/guidesx',
  '/guides/some-guide/extra',
  '/og/guides',
  '/og/guides/some-guide/extra',
  '/og/other',
  '/ogx',
  '/brand',
  '/brand/',
  '/brand/sub/file.png',
  '/brands/logo.png',
  '/sitemap.xml',
];

/** Each guide sits one level below /guides and may be indexed once the switch is on. */
const GUIDE_PAGES = ['/guides/some-guide', '/guides/some-guide/', '/guides/plan-a-week-of-pub-posts'];

/**
 * Images the structured data names: the logo and the share images. Google's
 * Organization and Article guidelines need them crawlable and indexable.
 */
const INDEXABLE_FILES = ['/brand/cheers-icon-512.png', '/og', '/og/', '/og/guides/some-guide'];

describe('security headers', () => {
  it('send the security headers on every path, indexable or not', () => {
    for (const path of [...INDEXABLE_PATHS, ...GUIDE_PAGES, ...INDEXABLE_FILES, ...NOT_INDEXABLE]) {
      const headers = headersFor(path);
      expect(headers['X-Frame-Options'], path).toBe('DENY');
      expect(headers['X-Content-Type-Options'], path).toBe('nosniff');
      expect(headers['Strict-Transport-Security'], path).toBe('max-age=31536000; includeSubDomains');
      expect(headers['Content-Security-Policy'], path).toContain("frame-ancestors 'none'");
    }
  });

  it('never send X-Robots-Tag on the home page and the three legal pages, so they can be indexed once sign-up opens (P11)', () => {
    expect(INDEXABLE_PATHS).toEqual(['/', '/terms', '/privacy', '/data-processing', '/guides']);
    for (const path of [...INDEXABLE_PATHS, '/terms/', '/privacy/', '/data-processing/']) {
      expect(headersFor(path)['X-Robots-Tag'], path).toBeUndefined();
    }
  });

  it('never send X-Robots-Tag on /guides or a guide one level below it', () => {
    expect(INDEXABLE_SECTIONS).toEqual(['/guides']);
    for (const path of ['/guides', '/guides/', ...GUIDE_PAGES]) {
      expect(headersFor(path)['X-Robots-Tag'], path).toBeUndefined();
    }
  });

  it('never send X-Robots-Tag on the logo or the share images the structured data names', () => {
    for (const path of INDEXABLE_FILES) {
      expect(headersFor(path)['X-Robots-Tag'], path).toBeUndefined();
    }
  });

  it('let the Cloudflare Turnstile script and iframe load on the sign-up form, and nothing else from Cloudflare', () => {
    const csp = headersFor('/signup')['Content-Security-Policy'] ?? '';
    const directive = (name: string) =>
      csp
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name} `)) ?? '';
    expect(directive('script-src').split(' ')).toContain('https://challenges.cloudflare.com');
    expect(directive('frame-src').split(' ')).toContain('https://challenges.cloudflare.com');
    expect(directive('connect-src')).not.toContain('cloudflare');
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(csp.match(/cloudflare/g)).toHaveLength(2);
  });

  it('keep X-Robots-Tag noindex on every other path', () => {
    for (const path of NOT_INDEXABLE) {
      expect(headersFor(path)['X-Robots-Tag'], path).toBe('noindex, nofollow');
    }
  });
});
