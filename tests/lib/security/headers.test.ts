import { buildCustomRoute } from 'next/dist/lib/build-custom-route';
import { describe, expect, it } from 'vitest';

import { INDEXABLE_PATHS, securityHeaders } from '@/lib/security/headers';

/**
 * The headers each path gets, matched the way Next compiles `headers()` rules
 * into the routes manifest (buildCustomRoute), so the test checks the same
 * regex production serves with.
 */
function headersFor(pathname: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rule of securityHeaders) {
    const { regex } = buildCustomRoute('header', rule) as { regex: string };
    if (new RegExp(regex).test(pathname)) {
      for (const header of rule.headers) result[header.key] = header.value;
    }
  }
  return result;
}

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
];

describe('security headers', () => {
  it('send the security headers on every path, indexable or not', () => {
    for (const path of [...INDEXABLE_PATHS, ...NOT_INDEXABLE]) {
      const headers = headersFor(path);
      expect(headers['X-Frame-Options'], path).toBe('DENY');
      expect(headers['X-Content-Type-Options'], path).toBe('nosniff');
      expect(headers['Strict-Transport-Security'], path).toBe('max-age=31536000; includeSubDomains');
      expect(headers['Content-Security-Policy'], path).toContain("frame-ancestors 'none'");
    }
  });

  it('never send X-Robots-Tag on the home page and the three legal pages, so they can be indexed once sign-up opens (P11)', () => {
    expect(INDEXABLE_PATHS).toEqual(['/', '/terms', '/privacy', '/data-processing']);
    for (const path of [...INDEXABLE_PATHS, '/terms/', '/privacy/', '/data-processing/']) {
      expect(headersFor(path)['X-Robots-Tag'], path).toBeUndefined();
    }
  });

  it('keep X-Robots-Tag noindex on every other path', () => {
    for (const path of NOT_INDEXABLE) {
      expect(headersFor(path)['X-Robots-Tag'], path).toBe('noindex, nofollow');
    }
  });
});
