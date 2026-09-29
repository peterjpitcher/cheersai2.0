import type { MetadataRoute } from 'next';

import { listGuides } from '@/content/guides';
import { sitemapFor } from '@/lib/marketing/sitemap';

/**
 * sitemap.xml: the public pages with their content dates, whatever the
 * sign-up switch says. It changes only with a deploy, so it is built once.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapFor(listGuides());
}
