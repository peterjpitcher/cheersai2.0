import type { Metadata, MetadataRoute } from 'next';

import { GUIDES_PATH } from '@/lib/guides/guides';
import { LEGAL_DOCUMENTS } from '@/lib/legal/company';
import { absoluteUrl } from '@/lib/marketing/site';
import type { SelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * What the public sees at the front door (SPEC-homepage-and-guides §3).
 *
 * The homepage, the guides and the three legal pages are public, and search
 * engines may index them, whatever the self-serve sign-up switch says. Peter
 * decided on 29 September 2026 to publish them before sign-up opens, because
 * search engines take weeks to find new pages; sign-up itself waits for Meta
 * App Review. Only the call to action follows the switch: "Start your free
 * trial" while sign-up is open, "Talk to us" otherwise (./switch.ts reads a
 * failed read, and the switch on while billing enforcement is off, as not
 * open).
 */

/** The landing page offers sign-up only when the switch is on; anything else is "Talk to us". */
export type FrontDoorCta = 'trial' | 'talk';

export function frontDoorCta(state: SelfServeSignupSwitch): FrontDoorCta {
  return state === 'open' ? 'trial' : 'talk';
}

/**
 * Files a search engine needs to show the public pages properly: their CSS,
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
 * robots.txt: the home page (`/$`, the home page only, not every path), the
 * three legal pages, the guides (`/guides` and below) and the files those
 * pages need, nothing else, plus the sitemap. The longest matching rule wins,
 * so each allow beats `/`. The app, sign-up and login stay disallowed.
 */
export function publicRobots(): MetadataRoute.Robots {
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
 * Page metadata for a public page. The root layout marks every page noindex;
 * this lifts it for the pages search engines may index. (Vercel still sends
 * `x-robots-tag: noindex` on Preview deployments, which wins there.)
 */
export function indexable(metadata: Metadata): Metadata {
  return { ...metadata, robots: { index: true, follow: true } };
}
