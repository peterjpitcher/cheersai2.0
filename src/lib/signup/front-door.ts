import type { Metadata, MetadataRoute } from 'next';

import type { Guide } from '@/content/guides/types';
import { env } from '@/env';
import { GUIDES_PATH } from '@/lib/guides/guides';
import { LEGAL_DOCUMENTS } from '@/lib/legal/company';
import { absoluteUrl } from '@/lib/marketing/site';
import type { SelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * What the public sees at the front door, decided by the sign-up switch
 * (SPEC-self-serve-signup §4.1, P11).
 *
 * Peter was promised that nothing new is public until he decides, so while
 * the switch is off (or cannot be read, or is on while billing enforcement is
 * off: ./switch.ts reads all three as not open) production behaves exactly as
 * before this change: `/` sends signed-out visitors to the login page,
 * robots.txt disallows everything and every page stays noindex. Only when the
 * switch is open does `/` show the landing page and may search engines index
 * `/` and the three legal pages.
 *
 * The one exception is a Vercel Preview or local development server, which
 * shows the landing page with the switch off so Peter can approve the copy on
 * the PR preview (§4.1). Previews sit behind Vercel's login and Vercel sends
 * `x-robots-tag: noindex` on them (both checked 28 September 2026).
 */

export interface Deployment {
  /** VERCEL_ENV: "production", "preview" or "development"; unset off Vercel. */
  vercelEnv?: string;
  /** NODE_ENV of the running server. */
  nodeEnv?: string;
}

export function currentDeployment(): Deployment {
  return { vercelEnv: env.server.VERCEL_ENV || undefined, nodeEnv: process.env.NODE_ENV };
}

/** A Vercel Preview or a local dev server, where the public pages show whatever the switch says. */
function isPreviewOrLocalDev(deployment: Deployment): boolean {
  return deployment.vercelEnv === 'preview' || deployment.nodeEnv === 'development';
}

/** Whether a signed-out visitor to `/` sees the landing page (otherwise the login page). */
export function frontDoorVisible(state: SelfServeSignupSwitch, deployment: Deployment): boolean {
  return state === 'open' || isPreviewOrLocalDev(deployment);
}

/**
 * Whether the guides (/guides, each guide and its share image) are shown for
 * this request (SPEC-homepage-and-guides §3):
 *
 * - "visible" once the switch is on and at least one guide exists, and on a
 *   Vercel Preview or local dev server whenever a guide exists, so Peter can
 *   approve article copy on the PR preview as he did the homepage. They stay
 *   noindex there: only an open switch lifts the noindex meta tag, and Vercel
 *   sends `x-robots-tag: noindex` on previews.
 * - "hidden" (not found, and linked from nowhere) while there are no guides,
 *   or in production while the switch is off.
 * - "unavailable" in production when the switch cannot be read and guides
 *   exist. The pages then answer with a temporary server error, not "not
 *   found", so search engines keep the guides they have indexed (see
 *   SwitchUnavailableError).
 *
 * The sitemap and robots.txt name the guides only while the switch is on.
 */
export type GuidesVisibility = 'visible' | 'hidden' | 'unavailable';

export function guidesVisibility(
  state: SelfServeSignupSwitch,
  guides: readonly Guide[],
  deployment: Deployment,
): GuidesVisibility {
  if (!guides.length) return 'hidden';
  if (state === 'open' || isPreviewOrLocalDev(deployment)) return 'visible';
  return state === 'unavailable' ? 'unavailable' : 'hidden';
}

/**
 * Thrown by public pages and files that follow the switch when it cannot be
 * read in production (the guides, sitemap.xml and robots.txt), so they answer
 * with a temporary server error (500) instead of "gone". Google drops indexed
 * URLs that return 404 but keeps them through a 5xx, and it caches a 200
 * robots.txt (here, one that disallows everything) for up to a day but retries
 * a failed one and keeps its last good copy. Nothing new is shown, so a failed
 * read still fails closed. The share images answer 503 instead (og-image.tsx).
 */
export class SwitchUnavailableError extends Error {
  constructor(surface: string) {
    super(`The self-serve sign-up switch could not be read, so ${surface} is temporarily unavailable.`);
    this.name = 'SwitchUnavailableError';
  }
}

/** The landing page offers sign-up only when the switch is on; anything else is "Talk to us". */
export type FrontDoorCta = 'trial' | 'talk';

export function frontDoorCta(state: SelfServeSignupSwitch): FrontDoorCta {
  return state === 'open' ? 'trial' : 'talk';
}

/**
 * Files a search engine needs to show the open pages properly: their CSS,
 * scripts and images, the logo named in the structured data, the share
 * images (X's crawler obeys robots.txt), the favicons and the sitemap itself
 * (Google fetches a sitemap only if robots.txt allows it). They are files, not
 * pages, so they add nothing to the pages that may be indexed.
 */
export const CRAWLABLE_FILES = [
  '/_next/static/',
  '/_next/image',
  '/brand/',
  '/og',
  '/favicon.ico',
  '/icon.png',
  '/apple-icon.png',
  '/sitemap.xml',
] as const;

/**
 * robots.txt. Closed: disallow everything, as before. Open (P11 and
 * SPEC-homepage-and-guides): the home page (`/$`, the home page only, not
 * every path), the three legal pages, the guides (`/guides` and below) and
 * the files those pages need, nothing else, plus the sitemap. The longest
 * matching rule wins, so each allow beats `/`.
 */
export function robotsFor(state: SelfServeSignupSwitch): MetadataRoute.Robots {
  if (state !== 'open') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$', ...Object.values(LEGAL_DOCUMENTS).map((doc) => doc.path), GUIDES_PATH, ...CRAWLABLE_FILES],
        disallow: '/',
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}

/**
 * Page metadata for a page search engines may index once sign-up is open. The
 * root layout marks every page noindex; this lifts it only while the switch is
 * on, so a closed front door serves exactly the robots meta it served before.
 */
export function indexableWhenOpen(metadata: Metadata, state: SelfServeSignupSwitch): Metadata {
  if (state !== 'open') return metadata;
  return { ...metadata, robots: { index: true, follow: true } };
}
