import { env } from '@/env';

/**
 * The public site's origin, for canonical links, the sitemap, robots.txt,
 * share images and structured data. It comes from NEXT_PUBLIC_SITE_URL through
 * src/env.ts, which a production build requires to be the deployed domain
 * (https://cheers.orangejelly.co.uk) and never localhost. Nothing hard-codes it.
 */
export function siteOrigin(): string {
  return new URL(env.client.NEXT_PUBLIC_SITE_URL).origin;
}

/** The absolute URL of a path on the public site, for example "/guides". */
export function absoluteUrl(path: string): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}
