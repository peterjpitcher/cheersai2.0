import type { MetadataRoute } from 'next';

import { listGuides } from '@/content/guides';
import { sitemapFor } from '@/lib/marketing/sitemap';
import { SwitchUnavailableError } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * sitemap.xml follows the self-serve sign-up switch: empty while it is off;
 * once it is on, the public pages with their content dates. When the switch
 * cannot be read it answers a server error rather than an empty sitemap, so
 * search engines retry instead of forgetting the pages (front-door.ts).
 * Rendered per request (one small read) so a flip shows at once.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const state = await getSelfServeSignupSwitch();
  if (state === 'unavailable') throw new SwitchUnavailableError('sitemap.xml');
  return sitemapFor(state, listGuides());
}
