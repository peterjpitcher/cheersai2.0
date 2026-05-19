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
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co https://*.axiom.co",
  "frame-ancestors 'none'",
].join('; ');

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
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Content-Security-Policy', value: contentSecurityPolicy },
    ],
  },
];
