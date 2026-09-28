/**
 * Security headers applied to all Next.js responses.
 *
 * Configured as a standalone module for import into next.config.ts.
 * Covers AUTH-05 requirements: CSP, HSTS, X-Frame-Options, Referrer-Policy.
 */

interface SecurityHeader {
  key: string;
  value: string;
}

interface HeaderConfig {
  source: string;
  headers: SecurityHeader[];
}

/**
 * Content Security Policy directive.
 * Uses unsafe-inline for styles (required by Tailwind CSS).
 * Uses unsafe-eval for scripts (required by Next.js dev mode).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.axiom.co https://*.vercel.app https://*.vercel-scripts.com https://*.vercel-insights.com https://*.vercel-analytics.com",
  "frame-src 'self' https://vercel.live",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The pages search engines may index once the self-serve sign-up switch is on
 * (SPEC-self-serve-signup P11): the home page and the three legal pages. They
 * never get the X-Robots-Tag header, which a page cannot override. While the
 * switch is off they stay out of search through the root layout's noindex
 * meta tag and robots.txt, both of which follow the switch.
 */
export const INDEXABLE_PATHS = ['/', '/terms', '/privacy', '/data-processing'] as const;

/**
 * Every path except INDEXABLE_PATHS. `.+` leaves out `/`; the lookahead leaves
 * out the three legal pages (with or without a trailing slash) but not paths
 * below them.
 */
const NOT_INDEXABLE_SOURCE = '/:path((?!(?:terms|privacy|data-processing)/?$).+)';

/** Security headers for all routes. Import into next.config.ts headers(). */
export const securityHeaders: HeaderConfig[] = [
  {
    source: '/:path*',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      },
      { key: 'Content-Security-Policy', value: contentSecurityPolicy },
    ],
  },
  {
    source: NOT_INDEXABLE_SOURCE,
    headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
  },
];
