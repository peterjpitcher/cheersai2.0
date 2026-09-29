import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { listGuides } from '@/content/guides';
import { GuideArticlePage } from '@/features/guides/guide-article-page';
import { findGuide, relatedGuides } from '@/lib/guides/guides';
import { guideMetadata } from '@/lib/marketing/metadata';
import { frontDoorCta, indexable } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * `/guides/<slug>` (SPEC-homepage-and-guides §3): one guide; not found for a
 * slug that is not a guide.
 *
 * generateStaticParams lists every guide, which loads (and so checks) every
 * article module at build time. Pages still render per request, because the
 * call to action follows the sign-up switch.
 */
export const dynamic = 'force-dynamic';

interface GuidePageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): { slug: string }[] {
  return listGuides().map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const guide = findGuide(listGuides(), (await params).slug);
  // An unknown guide is only a 404: it keeps the site-wide noindex.
  if (!guide) return {};
  return indexable(guideMetadata(guide));
}

export default async function GuidePage({ params }: GuidePageProps): Promise<React.JSX.Element> {
  const guides = listGuides();
  const guide = findGuide(guides, (await params).slug);
  if (!guide) notFound();
  return (
    <GuideArticlePage
      guide={guide}
      related={relatedGuides(guide, guides)}
      cta={frontDoorCta(await getSelfServeSignupSwitch())}
    />
  );
}
