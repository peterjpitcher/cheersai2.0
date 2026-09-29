import type { MetadataRoute } from 'next';

import { listGuides } from '@/content/guides';
import { sitemapFor } from '@/lib/marketing/sitemap';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * sitemap.xml follows the self-serve sign-up switch: empty while it is off or
 * unreadable; once it is on, the public pages with their content dates.
 * Rendered per request (one small read) so a flip shows at once.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapFor(await getSelfServeSignupSwitch(), listGuides());
}
