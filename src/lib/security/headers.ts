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
 * challenges.cloudflare.com serves the Cloudflare Turnstile script and its
 * iframe on the /signup form (SPEC-self-serve-signup §4.12); Cloudflare's
 * Turnstile CSP guide asks for exactly script-src and frame-src.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.axiom.co https://*.vercel.app https://*.vercel-scripts.com https://*.vercel-insights.com https://*.vercel-analytics.com",
  "frame-src 'self' https://vercel.live https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The pages search engines may index once the self-serve sign-up switch is on
 * (SPEC-self-serve-signup P11, SPEC-homepage-and-guides): the home page, the
 * three legal pages and the guides index. They never get the X-Robots-Tag
 * header, which a page cannot override. While the switch is off they stay out
 * of search through the root layout's noindex meta tag (the guides are not
 * found at all in production) and robots.txt, both of which follow the switch.
 */
export const INDEXABLE_PATHS = ['/', '/terms', '/privacy', '/data-processing', '/guides'] as const;

/**
 * Sections whose pages one level down may be indexed too: each guide at
 * /guides/<slug>. Deeper paths keep the header.
 */
export const INDEXABLE_SECTIONS = ['/guides'] as const;

/**
 * Every path except INDEXABLE_PATHS, the pages one level inside
 * INDEXABLE_SECTIONS, and the images the structured data names, which
 * Google's Organization and Article guidelines require to be crawlable and
 * indexable: the logo (a file directly in /brand) and the share images (/og
 * and /og/guides/<slug>). The share images answer 404 while the switch is off;
 * the static /brand files stay out of search through robots.txt until then.
 *
 * `.+` leaves out `/`; the lookahead leaves out the legal pages, /guides,
 * /guides/<slug>, /brand/<file>, /og and /og/guides/<slug> (each with or
 * without a trailing slash), but not paths below those.
 */
const NOT_INDEXABLE_SOURCE =
  '/:path((?!(?:terms|privacy|data-processing|guides(?:/[^/]+)?|brand/[^/]+|og(?:/guides/[^/]+)?)/?$).+)';

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
