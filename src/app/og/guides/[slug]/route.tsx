import { listGuides } from '@/content/guides';
import { guideCategory } from '@/content/guides/categories';
import { findGuide, guidesVisible } from '@/lib/guides/guides';
import { COMPANY } from '@/lib/legal/company';
import { renderShareImage, shareImageNotFound } from '@/lib/marketing/og-image';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * A guide's share image. Like the guide itself, it is not found while the
 * sign-up switch is off or unreadable, and for a slug that is not a guide.
 */
export const dynamic = 'force-dynamic';

interface GuideImageContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: Request, { params }: GuideImageContext): Promise<Response> {
  const { slug } = await params;
  const guides = listGuides();
  const guide = guidesVisible(await getSelfServeSignupSwitch(), guides) ? findGuide(guides, slug) : undefined;
  if (!guide) return shareImageNotFound();
  return renderShareImage({
    eyebrow: `Guide: ${guideCategory(guide.category).label}`,
    title: guide.title,
    footer: `${COMPANY.siteHost}/guides`,
  });
}
