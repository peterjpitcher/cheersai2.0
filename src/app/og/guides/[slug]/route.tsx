import { listGuides } from '@/content/guides';
import { guideCategory } from '@/content/guides/categories';
import { findGuide } from '@/lib/guides/guides';
import { COMPANY } from '@/lib/legal/company';
import { renderShareImage, shareImageNotFound, shareImageUnavailable } from '@/lib/marketing/og-image';
import { currentDeployment, guidesVisibility } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * A guide's share image. It follows the guide itself (guidesVisibility): not
 * found for a slug that is not a guide and in production while the sign-up
 * switch is off, 503 when the switch cannot be read, and shown on a Preview or
 * local dev server for copy approval.
 */
export const dynamic = 'force-dynamic';

interface GuideImageContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: Request, { params }: GuideImageContext): Promise<Response> {
  const { slug } = await params;
  const guides = listGuides();
  const visibility = guidesVisibility(await getSelfServeSignupSwitch(), guides, currentDeployment());
  if (visibility === 'unavailable') return shareImageUnavailable();
  const guide = visibility === 'visible' ? findGuide(guides, slug) : undefined;
  if (!guide) return shareImageNotFound();
  return renderShareImage({
    eyebrow: `Guide: ${guideCategory(guide.category).label}`,
    title: guide.title,
    footer: `${COMPANY.siteHost}/guides`,
  });
}
