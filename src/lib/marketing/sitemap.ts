import type { MetadataRoute } from 'next';

import { HOME_CONTENT_UPDATED } from '@/content/homepage';
import type { Guide } from '@/content/guides/types';
import { byNewest, GUIDES_PATH, guidePath, lastUpdated } from '@/lib/guides/guides';
import { LEGAL_DOCUMENTS, LEGAL_UPDATED } from '@/lib/legal/company';
import { absoluteUrl } from '@/lib/marketing/site';
import { ukLongDateToIso } from '@/lib/utils/date';

/**
 * sitemap.xml (SPEC-homepage-and-guides §3): the homepage, /guides and every
 * guide (only when there are guides), and the three legal pages, each dated
 * by its content (the homepage copy date, a guide's updated date, the legal
 * pages' LEGAL_UPDATED). It lists the pages robots.txt allows, whatever the
 * sign-up switch says.
 */
export function sitemapFor(guides: readonly Guide[]): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [{ url: absoluteUrl('/'), lastModified: HOME_CONTENT_UPDATED }];

  const newest = lastUpdated(guides);
  if (newest) {
    entries.push({ url: absoluteUrl(GUIDES_PATH), lastModified: newest });
    for (const guide of [...guides].sort(byNewest)) {
      entries.push({ url: absoluteUrl(guidePath(guide.slug)), lastModified: guide.updated });
    }
  }

  const legalUpdated = ukLongDateToIso(LEGAL_UPDATED);
  for (const doc of Object.values(LEGAL_DOCUMENTS)) {
    entries.push(legalUpdated ? { url: absoluteUrl(doc.path), lastModified: legalUpdated } : { url: absoluteUrl(doc.path) });
  }

  return entries;
}
