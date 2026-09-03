/**
 * Redirects for the retired cheersai.uk hostnames.
 *
 * The app now lives on cheers.orangejelly.co.uk. cheersai.uk is kept registered
 * as a defensive asset and redirects here, so historic links (notably the
 * Instagram bio) keep working.
 *
 * Configured as a standalone module for import into next.config.ts, matching
 * how `securityHeaders` is handled, so the rules can be unit tested.
 *
 * Two deliberate choices:
 *
 * 1. **Temporary (307), not permanent.** A permanent redirect is cached by
 *    clients, which would defeat the rollback path while the migration is still
 *    inside its observation window. Revisit once the soak has passed.
 *
 * 2. **Browser traffic only.** This is not a bridge for server-to-server calls.
 *    A cross-origin redirect strips the `Authorization` header at every status
 *    code (301, 302, 307 and 308 alike), so an authenticated POST that followed
 *    this redirect would arrive unauthenticated and be rejected. Every such
 *    caller was repointed at the new origin directly before this was added.
 *    Custom headers such as `x-api-key` do survive, but no caller should rely
 *    on that.
 */

interface HostRedirect {
  source: string;
  has: { type: 'host'; value: string }[];
  destination: string;
  permanent: boolean;
}

/** The origin the app is served from. */
const NEW_ORIGIN = 'https://cheers.orangejelly.co.uk';

/** Hostnames being retired. The apex is listed even though Vercel answers it
 * first with its own redirect, so the rule survives that being removed. */
const LEGACY_HOSTS = ['www.cheersai.uk', 'cheersai.uk'] as const;

/**
 * Path and query are both preserved: `:path*` carries the path, and Next
 * forwards the query string automatically because the destination declares
 * none of its own.
 */
export const legacyHostRedirects: HostRedirect[] = LEGACY_HOSTS.map((host) => ({
  source: '/:path*',
  has: [{ type: 'host', value: host }],
  destination: `${NEW_ORIGIN}/:path*`,
  permanent: false,
}));
