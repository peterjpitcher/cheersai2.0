import { listGuides } from '@/content/guides';
import { guideCategory } from '@/content/guides/categories';
import { findGuide } from '@/lib/guides/guides';
import { COMPANY } from '@/lib/legal/company';
import { renderShareImage, shareImageNotFound } from '@/lib/marketing/og-image';

/** A guide's share image, public like the guide; not found for a slug that is not a guide. */
interface GuideImageContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: Request, { params }: GuideImageContext): Promise<Response> {
  const guide = findGuide(listGuides(), (await params).slug);
  if (!guide) return shareImageNotFound();
  return renderShareImage({
    eyebrow: `Guide: ${guideCategory(guide.category).label}`,
    title: guide.title,
    footer: `${COMPANY.siteHost}/guides`,
  });
}
