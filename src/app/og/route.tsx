import { HOME_SEO } from '@/content/seo';
import { COMPANY } from '@/lib/legal/company';
import { renderShareImage, shareImageNotFound } from '@/lib/marketing/og-image';
import { currentDeployment, frontDoorVisible } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * The homepage's share image (Open Graph and Twitter card). It follows the
 * homepage: not found while the sign-up switch is off or unreadable, except on
 * a Vercel Preview or a local dev server, where the homepage shows for copy
 * approval. Rendered per request so a flip shows at once.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const state = await getSelfServeSignupSwitch();
  if (!frontDoorVisible(state, currentDeployment())) return shareImageNotFound();
  return renderShareImage({
    eyebrow: HOME_SEO.imageEyebrow,
    title: HOME_SEO.imageHeadline,
    footer: COMPANY.siteHost,
  });
}
