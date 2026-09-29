import { HOME_SEO } from '@/content/seo';
import { COMPANY } from '@/lib/legal/company';
import { renderShareImage } from '@/lib/marketing/og-image';

/** The homepage's share image (Open Graph and Twitter card), public like the homepage. */
export async function GET(): Promise<Response> {
  return renderShareImage({
    eyebrow: HOME_SEO.imageEyebrow,
    title: HOME_SEO.imageHeadline,
    footer: COMPANY.siteHost,
  });
}
