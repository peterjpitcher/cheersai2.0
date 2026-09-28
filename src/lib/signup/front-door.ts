import type { Metadata, MetadataRoute } from 'next';

import { env } from '@/env';
import { LEGAL_DOCUMENTS } from '@/lib/legal/company';
import type { SelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * What the public sees at the front door, decided by the sign-up switch
 * (SPEC-self-serve-signup §4.1, P11).
 *
 * Peter was promised that nothing new is public until he decides, so while
 * the switch is off (or cannot be read) production behaves exactly as before
 * this change: `/` sends signed-out visitors to the login page, robots.txt
 * disallows everything and every page stays noindex. Only when the switch is
 * on does `/` show the landing page and may search engines index `/` and the
 * three legal pages.
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

/** Whether a signed-out visitor to `/` sees the landing page (otherwise the login page). */
export function frontDoorVisible(state: SelfServeSignupSwitch, deployment: Deployment): boolean {
  if (state === 'open') return true;
  return deployment.vercelEnv === 'preview' || deployment.nodeEnv === 'development';
}

/** The landing page offers sign-up only when the switch is on; anything else is "Talk to us". */
export type FrontDoorCta = 'trial' | 'talk';

export function frontDoorCta(state: SelfServeSignupSwitch): FrontDoorCta {
  return state === 'open' ? 'trial' : 'talk';
}

/**
 * robots.txt. Closed: disallow everything, as before. Open (P11): the home
 * page (`/$`, the home page only, not every path) and the three legal pages,
 * nothing else. The longest matching rule wins, so each allow beats `/`.
 */
export function robotsFor(state: SelfServeSignupSwitch): MetadataRoute.Robots {
  if (state !== 'open') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$', ...Object.values(LEGAL_DOCUMENTS).map((doc) => doc.path)],
        disallow: '/',
      },
    ],
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
