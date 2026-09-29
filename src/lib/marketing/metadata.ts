import type { Metadata } from 'next';

import { guideCategory } from '@/content/guides/categories';
import type { Guide } from '@/content/guides/types';
import { BRAND_NAME, GUIDES_SEO, guideSeoTitle, HOME_SEO, homeDescription } from '@/content/seo';
import { GUIDES_PATH, guideImagePath, guidePath } from '@/lib/guides/guides';
import { absoluteUrl } from '@/lib/marketing/site';

/**
 * Page metadata for the public pages: title, description, canonical URL,
 * Open Graph and Twitter cards. Every URL is absolute on the canonical host
 * (src/lib/marketing/site.ts). Callers add indexing with indexable(), and
 * return nothing new at all for a page that is not found.
 */

/** Share images are drawn at the size Facebook, LinkedIn and X all accept. */
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** The homepage's share image (src/app/og/route.tsx); the guides index shares it too. */
export const HOME_IMAGE_PATH = '/og';

interface ShareImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

function shareImage(path: string, alt: string): ShareImage {
  return { url: absoluteUrl(path), ...SHARE_IMAGE_SIZE, alt };
}

export function homeMetadata(): Metadata {
  const url = absoluteUrl('/');
  const description = homeDescription();
  const image = shareImage(HOME_IMAGE_PATH, HOME_SEO.imageAlt);
  return {
    title: HOME_SEO.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: BRAND_NAME,
      locale: 'en_GB',
      title: HOME_SEO.socialTitle,
      description,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: HOME_SEO.socialTitle, description, images: [image] },
  };
}

export function guidesIndexMetadata(): Metadata {
  const url = absoluteUrl(GUIDES_PATH);
  // The same picture as the homepage, so the same words describe it.
  const image = shareImage(HOME_IMAGE_PATH, HOME_SEO.imageAlt);
  return {
    title: GUIDES_SEO.title,
    description: GUIDES_SEO.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: BRAND_NAME,
      locale: 'en_GB',
      title: GUIDES_SEO.heading,
      description: GUIDES_SEO.description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: GUIDES_SEO.heading,
      description: GUIDES_SEO.description,
      images: [image],
    },
  };
}

export function guideMetadata(guide: Guide): Metadata {
  const url = absoluteUrl(guidePath(guide.slug));
  const image = shareImage(guideImagePath(guide.slug), guide.title);
  const keywords = [guide.primaryKeyword, ...guide.secondaryKeywords];
  return {
    title: guideSeoTitle(guide),
    description: guide.description,
    keywords,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      siteName: BRAND_NAME,
      locale: 'en_GB',
      title: guide.title,
      description: guide.description,
      publishedTime: guide.published,
      modifiedTime: guide.updated,
      section: guideCategory(guide.category).label,
      tags: keywords,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: guide.title, description: guide.description, images: [image] },
  };
}
